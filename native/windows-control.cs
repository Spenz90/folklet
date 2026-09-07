using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Optional Crew native desktop helper. Input and output are JSON on stdio.
// No clipboard access, shell commands, saved screenshots or persistent settings.
internal static class NativeControl {
 [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct KeyInput { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] struct InputData { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyInput key; }
 [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputData data; }
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=32000000 };
 static Dictionary<string,object> Display(Rectangle b){return new Dictionary<string,object>{{"x",b.X},{"y",b.Y},{"width",b.Width},{"height",b.Height}};}
 static Input Key(ushort key,ushort scan,uint flags){return new Input{type=1,data=new InputData{key=new KeyInput{key=key,scan=scan,flags=flags}}};}
 static Input Mouse(uint flags,int data=0){return new Input{type=0,data=new InputData{mouse=new MouseInput{flags=flags,data=unchecked((uint)data)}}};}
 static void Send(List<Input> inputs){Input[] data=inputs.ToArray();if(SendInput((uint)data.Length,data,Marshal.SizeOf(typeof(Input)))!=data.Length)throw new InvalidOperationException("Desktop input was blocked.");}
 static ushort Code(string name){
  if(name.Length==1&&Char.IsLetterOrDigit(name[0])&&name[0]<128)return (ushort)Char.ToUpperInvariant(name[0]);
  int function;if(name.StartsWith("F")&&Int32.TryParse(name.Substring(1),out function)&&function>=1&&function<=12)return (ushort)(111+function);
  var map=new Dictionary<string,ushort>{{"Control",17},{"Shift",16},{"Alt",18},{"Meta",91},{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"Space",32},{"ArrowLeft",37},{"ArrowUp",38},{"ArrowRight",39},{"ArrowDown",40},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34}};
  ushort code;if(!map.TryGetValue(name,out code))throw new ArgumentException("Unsupported key.");return code;
 }
 static int Main(){try{
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  string raw=Console.In.ReadToEnd();if(raw.Length>24000)throw new ArgumentException("Request too large.");
  var a=Json.Deserialize<Dictionary<string,object>>(raw);if(a==null)throw new ArgumentException("Expected JSON.");
  if(!Environment.UserInteractive)throw new InvalidOperationException("An interactive desktop is required.");SetProcessDPIAware();
  Rectangle bounds=Screen.PrimaryScreen.Bounds;string action=Convert.ToString(a["action"]);
  if(action=="geometry"){Console.Write(Json.Serialize(Display(bounds)));return 0;}
  if(action=="look"){
   if((long)bounds.Width*bounds.Height>64000000)throw new InvalidOperationException("Display too large.");
   using(var bitmap=new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format32bppArgb))using(var graphics=Graphics.FromImage(bitmap))using(var buffer=new MemoryStream()){
    graphics.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size);bitmap.Save(buffer,ImageFormat.Png);
    Console.Write(Json.Serialize(new {image=Convert.ToBase64String(buffer.ToArray()),display=Display(bounds)}));return 0;
   }
  }
  var expected=a["expected"] as Dictionary<string,object>;if(expected==null)throw new ArgumentException("Look at the display first.");
  foreach(var pair in Display(bounds))if(!expected.ContainsKey(pair.Key)||Convert.ToDouble(expected[pair.Key])!=Convert.ToDouble(pair.Value))throw new InvalidOperationException("Display changed.");
  if(action=="click"){
   int x=Convert.ToInt32(a["x"]),y=Convert.ToInt32(a["y"]),count=Convert.ToInt32(a["clicks"]);if(!bounds.Contains(x,y)||count<1||count>2)throw new ArgumentException("Invalid click.");
   string button=Convert.ToString(a["button"]);uint down=button=="left"?2u:button=="right"?8u:button=="middle"?32u:0u;if(down==0)throw new ArgumentException("Invalid button.");
   if(!SetCursorPos(x,y))throw new InvalidOperationException("Pointer move blocked.");
   for(int i=0;i<count;i++){Send(new List<Input>{Mouse(down),Mouse(down*2)});if(i+1<count)Thread.Sleep(80);}
  }else if(action=="type"){
   string text=Convert.ToString(a["text"]);if(text.Length<1||text.Length>4000||text.IndexOf('\0')>=0)throw new ArgumentException("Invalid text.");
   var inputs=new List<Input>();foreach(char character in text){inputs.Add(Key(0,character,4));inputs.Add(Key(0,character,6));}Send(inputs);
  }else if(action=="key"){
   string[] parts=Convert.ToString(a["key"]).Split('+');if(parts.Length<1||parts.Length>4)throw new ArgumentException("Invalid shortcut.");
   var inputs=new List<Input>();foreach(string part in parts)inputs.Add(Key(Code(part),0,0));for(int i=parts.Length-1;i>=0;i--)inputs.Add(Key(Code(parts[i]),0,2));Send(inputs);
  }else if(action=="scroll"){
   int delta=Convert.ToInt32(a["delta"]);if(delta==0||Math.Abs(delta)>10)throw new ArgumentException("Invalid scroll.");Send(new List<Input>{Mouse(0x0800,-delta*120)});
  }else throw new ArgumentException("Unsupported action.");
  Console.Write("{\"ok\":true}");return 0;
 }catch{Console.Error.WriteLine("Native desktop operation failed. Check interactive desktop access and permissions.");return 1;}}
}

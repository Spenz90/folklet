import Foundation
import CoreGraphics
import ApplicationServices

// Built by the release maintainer. Uses Apple permissions without prompting,
// changing settings, taking clipboard ownership or starting privileged helpers.
struct NativeError: Error {}
func fail() throws { throw NativeError() }
func geometry() -> [String:Double] {
    let bounds = CGDisplayBounds(CGMainDisplayID())
    return ["x":bounds.origin.x,"y":bounds.origin.y,"width":bounds.width,"height":bounds.height]
}
func keyCode(_ key:String) throws -> CGKeyCode {
    let map:[String:CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29,"o":31,"u":32,"i":34,"p":35,"l":37,"j":38,"k":40,"n":45,"m":46,"Enter":36,"Tab":48,"Space":49,"Backspace":51,"Escape":53,"Delete":117,"Home":115,"End":119,"PageUp":116,"PageDown":121,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111]
    guard let result=map[key.count==1 ? key.lowercased():key] else { throw NativeError() };return result
}
func postKey(_ key:CGKeyCode,_ flags:CGEventFlags) throws {
    guard let down=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:false) else {throw NativeError()}
    down.flags=flags;up.flags=flags;down.post(tap:.cghidEventTap);up.post(tap:.cghidEventTap)
}
do {
    let raw=FileHandle.standardInput.readDataToEndOfFile()
    guard raw.count<=24000,let args=try JSONSerialization.jsonObject(with:raw) as? [String:Any],let action=args["action"] as? String else {throw NativeError()}
    let bounds=geometry()
    guard CGPreflightScreenCaptureAccess() else {throw NativeError()}
    if action=="geometry" {
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:bounds));exit(0)
    }
    guard AXIsProcessTrusted(),let expected=args["expected"] as? [String:Double],expected==bounds else {throw NativeError()}
    if action=="click" {
        guard let x=args["x"] as? Double,let y=args["y"] as? Double,let button=args["button"] as? String,let count=args["clicks"] as? Int,(1...2).contains(count),x>=bounds["x"]!,y>=bounds["y"]!,x<bounds["x"]!+bounds["width"]!,y<bounds["y"]!+bounds["height"]! else {throw NativeError()}
        let mouse:CGMouseButton,downType:CGEventType,upType:CGEventType
        switch button {case "left":mouse = .left;downType = .leftMouseDown;upType = .leftMouseUp;case "right":mouse = .right;downType = .rightMouseDown;upType = .rightMouseUp;case "middle":mouse = .center;downType = .otherMouseDown;upType = .otherMouseUp;default:throw NativeError()}
        let point=CGPoint(x:x,y:y)
        guard let move=CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:mouse) else {throw NativeError()};move.post(tap:.cghidEventTap)
        for click in 1...count {
            guard let down=CGEvent(mouseEventSource:nil,mouseType:downType,mouseCursorPosition:point,mouseButton:mouse),let up=CGEvent(mouseEventSource:nil,mouseType:upType,mouseCursorPosition:point,mouseButton:mouse) else {throw NativeError()}
            down.setIntegerValueField(.mouseEventClickState,value:Int64(click));up.setIntegerValueField(.mouseEventClickState,value:Int64(click));down.post(tap:.cghidEventTap);up.post(tap:.cghidEventTap);if click<count {Thread.sleep(forTimeInterval:0.08)}
        }
    } else if action=="type" {
        guard let text=args["text"] as? String,!text.isEmpty,text.utf16.count<=4000,!text.contains("\0") else {throw NativeError()}
        let units=Array(text.utf16);var start=0
        // Keep events small and never split a UTF-16 surrogate pair.
        while start<units.count {
            var end=min(start+20,units.count)
            if end<units.count && units[end-1]>=0xD800 && units[end-1]<=0xDBFF {end-=1}
            let chunk=Array(units[start..<end])
            guard let down=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:false) else {throw NativeError()}
            chunk.withUnsafeBufferPointer { buffer in down.keyboardSetUnicodeString(stringLength:chunk.count,unicodeString:buffer.baseAddress!);up.keyboardSetUnicodeString(stringLength:chunk.count,unicodeString:buffer.baseAddress!) }
            down.post(tap:.cghidEventTap);up.post(tap:.cghidEventTap);start=end;Thread.sleep(forTimeInterval:0.005)
        }
    } else if action=="key" {
        guard let key=args["key"] as? String else {throw NativeError()};var parts=key.components(separatedBy:"+");guard let last=parts.popLast(),parts.count<=3 else {throw NativeError()};var flags=CGEventFlags()
        for part in parts {switch part {case "Control":flags.insert(.maskControl);case "Alt":flags.insert(.maskAlternate);case "Shift":flags.insert(.maskShift);case "Meta":flags.insert(.maskCommand);default:throw NativeError()}}
        try postKey(keyCode(last),flags)
    } else if action=="scroll" {
        guard let delta=args["delta"] as? Int,delta != 0,abs(delta)<=10,let event=CGEvent(scrollWheelEvent2Source:nil,units:.line,wheelCount:1,wheel1:Int32(-delta),wheel2:0,wheel3:0) else {throw NativeError()};event.post(tap:.cghidEventTap)
    } else {throw NativeError()}
    FileHandle.standardOutput.write(Data("{\"ok\":true}".utf8))
} catch {
    FileHandle.standardError.write(Data("Native desktop access failed. Check Screen Recording and Accessibility permissions.\n".utf8));exit(1)
}

// Small, dependency-free renderer for bot messages and saved Markdown previews.
// HTML is always text. Only explicitly parsed HTTP(S) links create attributes;
// image syntax stays text so messages cannot trigger remote image requests.
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const escapedAt=(text,index)=>{let n=0;while(index>0&&text[--index]==='\\')n++;return n%2===1;};

function safeURL(value){
 const raw=value.replace(/\\([()\\])/g,'$1');
 if(!/^https?:\/\//i.test(raw)||/[\u0000-\u0020\u007f]/.test(raw))return null;
 try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)&&url.hostname?url.href:null;}catch{return null;}
}

function linkAt(text,start){
 let labelEnd=start+1,nesting=1;
 for(;labelEnd<text.length;labelEnd++){
  if(escapedAt(text,labelEnd))continue;
  if(text[labelEnd]==='[')nesting++;
  if(text[labelEnd]===']'&&!--nesting)break;
  if(text[labelEnd]==='\n')return null;
 }
 if(nesting||text[labelEnd+1]!=='(')return null;
 let end=labelEnd+2;nesting=1;
 for(;end<text.length;end++){
  if(escapedAt(text,end))continue;
  if(text[end]==='(')nesting++;
  if(text[end]===')'&&!--nesting)break;
  if(text[end]==='\n')return null;
 }
 if(nesting)return null;
 return {label:text.slice(start+1,labelEnd),url:text.slice(labelEnd+2,end),end:end+1};
}

function closing(text,marker,start){
 let end=text.indexOf(marker,start);
 while(end!==-1){if(!escapedAt(text,end))return end;end=text.indexOf(marker,end+marker.length);}
 return -1;
}

function inline(text,depth=0,allowLinks=true){
 if(depth>8)return escapeHTML(text);
 let html='';
 for(let i=0;i<text.length;){
  const char=text[i];
  if(char==='\\'&&/[\\`*_[\]{}()#+.!|>~-]/.test(text[i+1]||'')){html+=escapeHTML(text[i+1]);i+=2;continue;}
  if(char==='`'){
   const marker=text.slice(i).match(/^`+/)[0],end=closing(text,marker,i+marker.length);
   if(end!==-1){html+='<code>'+escapeHTML(text.slice(i+marker.length,end).replace(/\n/g,' '))+'</code>';i=end+marker.length;continue;}
  }
  if(char==='!'&&text[i+1]==='['){
   const image=linkAt(text,i+1);
   if(image){html+=escapeHTML(text.slice(i,image.end));i=image.end;continue;}
  }
  if(char==='['){
   const link=linkAt(text,i);
   if(link){
    const url=allowLinks?safeURL(link.url):null;
    html+=url?'<a href="'+escapeHTML(url)+'" target="_blank" rel="noopener noreferrer">'+inline(link.label,depth+1,false)+'</a>':escapeHTML(text.slice(i,link.end));
    i=link.end;continue;
   }
  }
  if(allowLinks&&char==='<'){
   const end=text.indexOf('>',i+1),url=end!==-1?safeURL(text.slice(i+1,end)):null;
   if(url){html+='<a href="'+escapeHTML(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(text.slice(i+1,end))+'</a>';i=end+1;continue;}
  }
  if(char==='*'||char==='_'){
   const marker=text.startsWith(char+char,i)?char+char:char;
   const intraword=char==='_'&&/[\p{L}\p{N}]/u.test(text[i-1]||'');
   if(!intraword&&text[i+marker.length]&&!/\s/.test(text[i+marker.length])){
    const end=closing(text,marker,i+marker.length);
    if(end>i+marker.length&&!/\s/.test(text[end-1])){
     const tag=marker.length===2?'strong':'em';
     html+='<'+tag+'>'+inline(text.slice(i+marker.length,end),depth+1,allowLinks)+'</'+tag+'>';i=end+marker.length;continue;
    }
   }
  }
  html+=char==='\n'?'<br>':escapeHTML(char);i++;
 }
 return html;
}

function cells(line){
 let source=line.trim();if(source.startsWith('|'))source=source.slice(1);
 if(source.endsWith('|')&&!escapedAt(source,source.length-1))source=source.slice(0,-1);
 const result=[];let cell='',ticks=0;
 for(let i=0;i<source.length;i++){
  if(source[i]==='`'&&!escapedAt(source,i)){
   const run=source.slice(i).match(/^`+/)[0];
   if(!ticks)ticks=run.length;else if(ticks===run.length)ticks=0;
   cell+=run;i+=run.length-1;continue;
  }
  if(source[i]==='|'&&!ticks&&!escapedAt(source,i)){result.push(cell.trim());cell='';}else cell+=source[i];
 }
 result.push(cell.trim());return result;
}

function tableAt(lines,index){
 if(!lines[index]?.includes('|')||!lines[index+1])return null;
 const header=cells(lines[index]),separator=cells(lines[index+1]);
 return header.length===separator.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))?{header,separator}:null;
}

function listAt(line){
 const match=/^( {0,3})([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
 return match?{indent:match[1].length,ordered:/^\d/.test(match[2]),start:parseInt(match[2],10),content:match[3],width:match[0].length-match[3].length}:null;
}
const fenceAt=line=>/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const headingAt=line=>/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
const quoteAt=line=>/^ {0,3}>[ \t]?(.*)$/.exec(line);
const ruleAt=line=>/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
function startsBlock(lines,i){return fenceAt(lines[i])||headingAt(lines[i])||quoteAt(lines[i])||ruleAt(lines[i])||listAt(lines[i])||tableAt(lines,i);}

function blocks(lines,depth=0){
 if(depth>8)return '<p>'+inline(lines.join('\n'))+'</p>';
 let html='',i=0;
 while(i<lines.length){
  if(!lines[i].trim()){i++;continue;}
  const fence=fenceAt(lines[i]),heading=headingAt(lines[i]),quote=quoteAt(lines[i]),table=tableAt(lines,i),list=listAt(lines[i]);
  if(fence){
   const marker=fence[1],endPattern=new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}[ \\t]*$');
   const language=fence[2].trim().split(/\s+/)[0],code=[];i++;
   while(i<lines.length&&!endPattern.test(lines[i]))code.push(lines[i++]);
   if(i<lines.length)i++;
   html+='<pre><code'+(/^[a-z\d_+-]+$/i.test(language)?' class="language-'+language+'"':'')+'>'+escapeHTML(code.join('\n'))+'</code></pre>';continue;
  }
  if(heading){const level=heading[1].length;html+='<h'+level+'>'+inline(heading[2].replace(/[ \t]+#+[ \t]*$/,''))+'</h'+level+'>';i++;continue;}
  if(ruleAt(lines[i])){html+='<hr>';i++;continue;}
  if(quote){
   const quoted=[];
   while(i<lines.length){const line=quoteAt(lines[i]);if(!line)break;quoted.push(line[1]);i++;}
   html+='<blockquote>'+blocks(quoted,depth+1)+'</blockquote>';continue;
  }
  if(table){
   const alignment=table.separator.map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':cell.startsWith(':')?'left':null);
   const row=(values,tag)=>'<tr>'+table.header.map((_,column)=>'<'+tag+(alignment[column]?' align="'+alignment[column]+'"':'')+'>'+inline(values[column]||'')+'</'+tag+'>').join('')+'</tr>';
   html+='<table><thead>'+row(table.header,'th')+'</thead><tbody>';i+=2;
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))html+=row(cells(lines[i++]),'td');
   html+='</tbody></table>';continue;
  }
  if(list){
   const tag=list.ordered?'ol':'ul';html+='<'+tag+(list.ordered&&list.start!==1?' start="'+list.start+'"':'')+'>';
   while(i<lines.length){
    const item=listAt(lines[i]);if(!item||item.indent!==list.indent||item.ordered!==list.ordered)break;
    const itemLines=[item.content];i++;
    while(i<lines.length){
     if(!lines[i].trim()){
      if(lines[i+1]&&/^ */.exec(lines[i+1])[0].length>=item.width){itemLines.push('');i++;continue;}
      break;
     }
     const indent=/^ */.exec(lines[i])[0].length;
     if(indent<item.width)break;
     itemLines.push(lines[i].slice(item.width));i++;
    }
    let content=blocks(itemLines,depth+1);
    if(content.startsWith('<p>')&&content.endsWith('</p>')&&content.indexOf('</p>')===content.length-4)content=content.slice(3,-4);
    html+='<li>'+content+'</li>';
   }
   html+='</'+tag+'>';continue;
  }
  const paragraph=[lines[i++]];
  while(i<lines.length&&lines[i].trim()&&!startsBlock(lines,i))paragraph.push(lines[i++]);
  html+='<p>'+inline(paragraph.join('\n'))+'</p>';
 }
 return html;
}

export function renderMarkdown(text){return blocks(String(text??'').replace(/\r\n?/g,'\n').split('\n'));}

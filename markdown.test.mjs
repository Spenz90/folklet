import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from './markdown.mjs';

test('renders representative agent output with headings, paragraphs, emphasis and lists',()=>{
 const output=renderMarkdown('# Project update\n\nWork is **complete** and *verified*.\nDetails follow.\n\n## Results\n- Saved `report.md`\n- Checked the output\n\n1. Review it\n2. Share when ready');
 assert.equal(output,'<h1>Project update</h1><p>Work is <strong>complete</strong> and <em>verified</em>.<br>Details follow.</p><h2>Results</h2><ul><li>Saved <code>report.md</code></li><li>Checked the output</li></ul><ol><li>Review it</li><li>Share when ready</li></ol>');
 assert.equal(renderMarkdown('file_name stays unchanged; _emphasis_ works.'),'<p>file_name stays unchanged; <em>emphasis</em> works.</p>');
});

test('escapes raw HTML, entities and event attributes in every content context',()=>{
 const output=renderMarkdown('# <img src=x onerror=alert(1)>\n\n<script>alert("x")</script> &lt;svg&gt;\n\n> <iframe src="https://example.com">\n\n- <input autofocus onfocus=alert(1)>');
 assert.doesNotMatch(output,/<(?:img|script|iframe|input|svg)\b/i);
 assert.match(output,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(output,/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp;lt;svg&amp;gt;/);
 assert.match(output,/<blockquote><p>&lt;iframe/);
});

test('links allow only HTTP(S), safely encode attributes, and support parentheses in URLs',()=>{
 const output=renderMarkdown('[Reference](https://example.com/a_(b)?x=1&y=2) and <http://example.org/page>');
 assert.match(output,/<a href="https:\/\/example.com\/a_\(b\)\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">Reference<\/a>/);
 assert.match(output,/<a href="http:\/\/example.org\/page"/);
 for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','file:///C:/private','//example.com','https:\n//example.com','https://example.com/" onmouseover="alert(1)','&#106;avascript:alert(1)','https://']){
  assert.doesNotMatch(renderMarkdown('[click]('+url+')'),/<a\b/,'Must reject '+url);
 }
 const quoted=renderMarkdown('[safe](https://example.com/"onclick="evil)');
 assert.match(quoted,/href="https:\/\/example.com\/%22onclick=%22evil"/);
 assert.doesNotMatch(quoted,/"onclick=/);
});

test('remote Markdown and HTML images never create image elements or automatic loads',()=>{
 const output=renderMarkdown('![tracking image](https://example.com/pixel.png)\n\n<img src="https://example.com/pixel.png">');
 assert.doesNotMatch(output,/<img\b|<a\b|<source\b|<iframe\b/i);
 assert.match(output,/!\[tracking image\]\(https:\/\/example.com\/pixel.png\)/);
 assert.match(output,/&lt;img src=&quot;https:/);
});

test('fenced and inline code remain literal, including unclosed streamed fences',()=>{
 assert.equal(renderMarkdown('```html\n<script>alert("x")</script>\n**literal**\n```'),'<pre><code class="language-html">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;\n**literal**</code></pre>');
 assert.equal(renderMarkdown('```js\nconst pending = true;'),'<pre><code class="language-js">const pending = true;</code></pre>');
 assert.equal(renderMarkdown('``use `ticks` and **literal**``'),'<p><code>use `ticks` and **literal**</code></p>');
 assert.doesNotMatch(renderMarkdown('```html" onmouseover="x\nhello\n```'),/class=/);
});

test('simple tables support alignment, escaped pipes and inline code without unsafe HTML',()=>{
 const output=renderMarkdown('| Item | Status |\n| :--- | ---: |\n| **Report** | Ready |\n| `a|b` | x\\|y |\n| <img src=x> | [View](https://example.com) |');
 assert.match(output,/<table><thead><tr><th align="left">Item<\/th><th align="right">Status<\/th><\/tr><\/thead><tbody>/);
 assert.match(output,/<td align="left"><code>a\|b<\/code><\/td><td align="right">x\|y<\/td>/);
 assert.match(output,/&lt;img src=x&gt;/);
 assert.doesNotMatch(output,/<img\b/);
 assert.equal(renderMarkdown('one | two\nnot | a separator'),'<p>one | two<br>not | a separator</p>');
});

test('blockquotes and nested lists retain readable structure',()=>{
 assert.equal(renderMarkdown('> ## Note\n>\n> Review **before sharing**.'),'<blockquote><h2>Note</h2><p>Review <strong>before sharing</strong>.</p></blockquote>');
 assert.equal(renderMarkdown('- Parent\n  - Child\n  - Another\n- Next'),'<ul><li><p>Parent</p><ul><li>Child</li><li>Another</li></ul></li><li>Next</li></ul>');
 assert.equal(renderMarkdown('3. Third\n4. Fourth'),'<ol start="3"><li>Third</li><li>Fourth</li></ol>');
});

test('escaped Markdown, malformed input, and synthetic placeholder strings stay safe',()=>{
 assert.equal(renderMarkdown('\\# literal\n\n\\*stars\\* and \\[label](https://example.com)'),'<p># literal</p><p>*stars* and [label](https://example.com)</p>');
 assert.equal(renderMarkdown(null),'');
 assert.equal(renderMarkdown('\u00000\u0000 <script>'),'<p>\u00000\u0000 &lt;script&gt;</p>');
 assert.doesNotMatch(renderMarkdown('[**<img onerror=x>**](javascript:alert(1))'),/<a\b|<img\b/);
 assert.doesNotMatch(renderMarkdown('> '.repeat(40)+'<svg onload=x>'),/<svg\b/);
});

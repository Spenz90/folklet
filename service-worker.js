/* Crew stores only this public fallback and original app icons for offline use.
 * API requests, pairing pages, app HTML, chats and credentials are never cached.
 * Keep this public allowlist explicit; do not replace it with app-shell caching.
 */
const CACHE_PREFIX='crew-public-offline-';
const CACHE_NAME=CACHE_PREFIX+'v3';
const OFFLINE_PATH='/offline.html';
const PUBLIC_ASSETS=new Map([
  [OFFLINE_PATH,'text/html'],
  ['/icons/crew-192.png','image/png'],
  ['/icons/crew-512.png','image/png'],
  ['/icons/crew-maskable-512.png','image/png'],
  ['/icons/apple-touch-icon.png','image/png'],
  ['/icons/crew.ico','image/x-icon']
]);

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.all([...PUBLIC_ASSETS].map(async([path,type])=>{
      // Fetch without cookies. A gateway must serve these public files directly.
      const response=await fetch(new Request(path,{credentials:'omit',cache:'no-store',redirect:'error'}));
      const contentType=response.headers.get('content-type')?.split(';')[0].trim();
      const expectedType=contentType===type||(type==='image/x-icon'&&contentType==='image/vnd.microsoft.icon');
      if(!response.ok||response.redirected||!expectedType)throw new Error('Crew public offline asset unavailable.');
      if(path===OFFLINE_PATH&&!((await response.clone().text()).includes('<meta name="crew-offline" content="public-v1">'))){
        throw new Error('Crew offline asset does not match the public fallback.');
      }
      await cache.put(path,response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await Promise.all((await caches.keys()).filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

async function offline(){
  const cached=await (await caches.open(CACHE_NAME)).match(OFFLINE_PATH);
  return cached||new Response('Crew cannot reach your host. Check your connection, keep Crew running on your computer or server, and try again.',{
    status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
  });
}

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  // Even a direct navigation to an API endpoint bypasses the worker entirely.
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request,{cache:'no-store'});
        return [502,503,504].includes(response.status)?await offline():response;
      }catch{return offline();}
    })());
    return;
  }
  if(!url.search&&PUBLIC_ASSETS.has(url.pathname)){
    // Read the install-time public cache only. Runtime responses never populate it.
    event.respondWith((async()=>{
      const cached=await (await caches.open(CACHE_NAME)).match(url.pathname);
      return cached||fetch(request,{cache:'no-store'});
    })());
  }
});

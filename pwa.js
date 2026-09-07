// Installation support adds no desktop UI and stores no user content.
if(window.isSecureContext&&'serviceWorker' in navigator){
  const register=()=>navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'}).catch(()=>{
    // Crew remains usable online if offline support is unavailable.
  });
  if(document.readyState==='complete')register();
  else window.addEventListener('load',register,{once:true});
}

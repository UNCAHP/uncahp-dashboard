// The client-side split-test snippet, served as a string from /api/track/script.
// Pasted into each funnel as: <script src="…/api/track/script" data-funnel="slug"></script>
//
// It runs in the VISITOR's browser (any funnel, any framework) and:
//   1. gives the visitor a sticky anonymous id + variant (cookies) — same visitor always
//      sees the same variation, so the test stays fair;
//   2. hides the non-chosen variation immediately (anti-flicker) — mark variant-specific
//      blocks with data-uc-variant="a" / "b"; only the chosen one shows;
//   3. beacons a 'view' (or a forced 'deposit'/'optin' on a confirmation page) to the
//      collector using text/plain so there's no CORS preflight to fail;
//   4. stamps every <form> with hidden ab_variant / ab_visitor fields and logs 'optin' on
//      submit, so opt-ins and deposits attribute back to the variation.
//
// COLLECTOR_URL is injected at serve time (same origin as this script).

export function buildSplitScript(collectorUrl: string): string {
  return `(function(){
  var s = document.currentScript;
  if(!s){return;}
  var FUNNEL = s.getAttribute('data-funnel');
  if(!FUNNEL){ if(window.console)console.warn('[uncahp-split] missing data-funnel'); return; }
  var VARIANTS = (s.getAttribute('data-variants')||'a,b').split(',').map(function(v){return v.trim();}).filter(Boolean);
  if(VARIANTS.length<1){VARIANTS=['a','b'];}
  var FORCE_EVENT = s.getAttribute('data-event')||'view';
  var VARIANT_FIELD = s.getAttribute('data-variant-field')||'ab_variant';
  var VISITOR_FIELD = s.getAttribute('data-visitor-field')||'ab_visitor';
  var COLLECTOR = ${JSON.stringify(collectorUrl)};
  var DAYS = 180;

  function getCookie(n){var m=document.cookie.match('(?:^|; )'+n.replace(/([.*+?^=!:$\{}()|\\[\\]\\/\\\\])/g,'\\\\$1')+'=([^;]*)');return m?decodeURIComponent(m[1]):null;}
  function setCookie(n,v){var d=new Date(Date.now()+DAYS*864e5);document.cookie=n+'='+encodeURIComponent(v)+'; expires='+d.toUTCString()+'; path=/; SameSite=Lax';}

  var vid = getCookie('uc_vid');
  if(!vid){vid=Date.now().toString(36)+Math.random().toString(36).slice(2,10);setCookie('uc_vid',vid);}

  var varCookie='uc_var_'+FUNNEL;
  var variant=getCookie(varCookie);
  if(!variant||VARIANTS.indexOf(variant)===-1){variant=VARIANTS[Math.floor(Math.random()*VARIANTS.length)];setCookie(varCookie,variant);}

  // Anti-flicker: hide only the non-chosen variant blocks; the chosen one keeps its
  // natural display. Injected into <head> before body paints.
  try{
    var st=document.createElement('style');
    st.textContent='[data-uc-variant]:not([data-uc-variant="'+variant+'"]){display:none!important}';
    (document.head||document.documentElement).appendChild(st);
    document.documentElement.setAttribute('data-uc-variant',variant);
  }catch(e){}

  function readUtm(){var p=new URLSearchParams(location.search),o={};['source','medium','campaign','content','term'].forEach(function(k){var v=p.get('utm_'+k);if(v)o[k]=v;});return o;}
  function send(event){
    try{
      var payload=JSON.stringify({funnel:FUNNEL,variant:variant,visitor_id:vid,event:event,url:location.href,referrer:document.referrer||null,utm:readUtm()});
      if(navigator.sendBeacon){navigator.sendBeacon(COLLECTOR,new Blob([payload],{type:'text/plain'}));}
      else{fetch(COLLECTOR,{method:'POST',body:payload,headers:{'Content-Type':'text/plain'},keepalive:true,mode:'no-cors'});}
    }catch(e){}
  }

  send(FORCE_EVENT);

  function addHidden(f,name,value){if(f.querySelector('input[name="'+name+'"]'))return;var i=document.createElement('input');i.type='hidden';i.name=name;i.value=value;f.appendChild(i);}
  function wireForms(){
    var forms=document.querySelectorAll('form');
    Array.prototype.forEach.call(forms,function(f){
      if(f.__ucWired)return;f.__ucWired=true;
      addHidden(f,VARIANT_FIELD,variant);addHidden(f,VISITOR_FIELD,vid);
      f.addEventListener('submit',function(){send('optin');});
    });
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',wireForms);}else{wireForms();}
})();`;
}

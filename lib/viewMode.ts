/**
 * Mobile and PC modes, like Amazon's app and desktop site.
 *  - Phones are told apart by a touch screen and a small physical screen, not by the width the browser
 *    reports, so a browser asking for the desktop site still gets Mobile mode.
 *  - Phones start in Mobile, everything else in PC. "Desktop site" / "Mobile site" switches it on this device.
 *  - Mobile: html.mobile turns the phone layout on at any width (see the sm/md/lg/xl variants in globals.css).
 *    If the browser still lays the page out at desktop width, the page is re-laid out at phone width with CSS zoom.
 *  - PC on a phone: a 1200px-wide page the phone scales to fit and you can pinch, like a desktop site.
 */
export const VIEW_KEY = "dk-view";
export type ViewMode = "mobile" | "pc";

export const viewBootScript = `(function(){try{
var d=document.documentElement,k=${JSON.stringify(VIEW_KEY)},s=null;try{s=localStorage.getItem(k)}catch(e){}
var sw=Math.min(screen.width,screen.height),touch=(navigator.maxTouchPoints||0)>0||(window.matchMedia&&matchMedia("(pointer: coarse)").matches);
var phone=!!touch&&sw<=600,m=s==="mobile"||(s!=="pc"&&phone);
d.classList.toggle("mobile",m);d.setAttribute("data-view",m?"mobile":"pc");if(phone)d.setAttribute("data-phone","1");
function vp(){var v=document.querySelector('meta[name="viewport"]');if(!v){v=document.createElement("meta");v.name="viewport";document.head.appendChild(v)}
var c=!m&&phone?"width=1200":"width=device-width, initial-scale=1, viewport-fit=cover";if(v.content!==c)v.content=c}
function fit(){if(!m||!phone){d.style.zoom="";return}var land=innerWidth>innerHeight,t=land?Math.max(screen.width,screen.height):sw,z=innerWidth/(d.style.zoom?1:1)/t;
d.style.zoom=z>1.15?z.toFixed(3):""}
vp();document.addEventListener("DOMContentLoaded",function(){vp();fit()});addEventListener("resize",fit);fit();
}catch(e){}})();`;

/** Switch modes on this device and reload so the page is laid out fresh. */
export function setViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {}
  location.reload();
}

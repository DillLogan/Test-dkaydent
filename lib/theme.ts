export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "dk-theme";

/**
 * Runs in <head> before the page paints: applies the saved choice as
 * data-theme on <html> (no flash), and keeps following the device while
 * the choice is "system".
 */
export const themeBootScript = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");
function pref(){try{return localStorage.getItem(k)||"system"}catch(e){return "system"}}
function apply(){var p=pref(),t=p==="system"?(m.matches?"dark":"light"):p;d.dataset.theme=t;d.dataset.themeChoice=p;d.style.colorScheme=t;}
apply();window.__dkApplyTheme=apply;
m.addEventListener("change",function(){if(pref()==="system")apply();});
}catch(e){}})();`;

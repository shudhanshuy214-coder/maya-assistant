package com.maya.assistant;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.AlarmClock;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * MAYA V1 — JavaScript bridge.
 * Exposed to the web page as  window.MayaNative
 *
 *教你Every @JavascriptInterface method is an OFFICIAL Android mechanism:
 *   - Intent/ACTION_VIEW for URLs and searches (OS handles the chooser)
 *   - AlarmClock.ACTION_SET_ALARM / SET_TIMER for reminders (official API)
 *   - SpeechRecognizer via MainActivity for voice
 *   - PackageManager for listing/launching installed apps (no phones' internals)
 *
 * The bridge never:
 *   - runs shell commands, reads/writes files, or accesses contacts/SMS/location
 *   - stores, logs, or transmits any secret (no API keys here ever)
 */
public class MayaBridge {

    private final MainActivity act;

    public MayaBridge(MainActivity act){ this.act = act; }

    /* ----------------voice / speech ---------------- */
    @JavascriptInterface public void speak(String text){ if(act != null) act.jsSpeak(text); }
    @JavascriptInterface public void stopSpeech(){ if(act != null) act.jsStopSpeech(); }
    @JavascriptInterface public void listen(){ if(act != null) act.jsStartListening(); }
    @JavascriptInterface public void stopListening(){ if(act != null) act.vibrateMs(0); }
    @JavascriptInterface public String speechLang(){ return Locale.getDefault().toString(); }
    @JavascriptInterface public void vibrate(int ms){ if(act != null) act.vibrateMs(ms); }

    /* ---------------- URLs & searches ---------------- */
    @JavascriptInterface public void openUrl(String url){
        safeStart(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    /* ---------------- app launching ---------------- */
    /** Try to launch an installed app by friendly name ("youtube", "whatsapp"...). */
    @JavascriptInterface public String openApp(String name){
        if(name == null) return opened(false);
        PackageManager pm = act.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN, null);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<android.content.pm.ResolveInfo> list = pm.queryIntentActivities(main, 0);
        String want = name.toLowerCase(Locale.US).replaceAll("\\s+","");
        for(android.content.pm.ResolveInfo ri : list){
            String label = String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.US).replaceAll("\\s+","");
            String pkg = ri.activityInfo.packageName.toLowerCase(Locale.US);
            if(label.contains(want) || pkg.contains(want)){
                Intent launch = pm.getLaunchIntentForPackage(ri.activityInfo.packageName);
                if(launch != null){ safeStart(launch); return opened(true); }
            }
        }
        return opened(false);
    }

    /* ---------------- official intent shortcuts ---------------- */
    @JavascriptInterface public void intent(String kind){
        if(kind == null) return;
        switch(kind){
            case "camera":
                safeStart(new Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA));
                break;
            case "settings":
                safeStart(new Intent(android.provider.Settings.ACTION_SETTINGS));
                break;
            case "wifi": safeStart(new Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)); break;
            case "bluetooth": safeStart(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)); break;
            case "maps":
                safeStart(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0")));
                break;
            case "alarm":
            case "clock":
                safeStart(new Intent(AlarmClock.ACTION_SHOW_ALARMS));
                break;
            case "calculator": {
                // official-ish: use Calculator's own MAIN launcher via generic resolution
                Intent i = act.getPackageManager().getLaunchIntentForPackage("com.android.calculator2");
                if(i == null) i = act.getPackageManager().getLaunchIntentForPackage("com.google.android.calculator");
                safeStart(i);
                break;
            }
            case "whatsapp": {
                try{
                    act.getPackageManager().getPackageInfo("com.whatsapp", 0);
                    safeStart(act.getPackageManager().getLaunchIntentForPackage("com.whatsapp"));
                }catch(PackageManager.NameNotFoundException e){
                    safeStart(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=com.whatsapp")));
                }
                break;
            }
            default: break;
        }
    }

    /* ---------------- reminders / alarms (official API) ---------------- */
    @JavascriptInterface public void reminder(String raw){
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, raw == null || raw.isEmpty() ? "Maya Reminder" : raw);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);      // user confirms in system UI
        if(i.resolveActivity(act.getPackageManager()) != null) safeStart(i);
        else {
            Intent t = new Intent(AlarmClock.ACTION_SET_TIMER);
            t.putExtra(AlarmClock.EXTRA_MESSAGE, "Maya Reminder");
            safeStart(t);
        }
    }

    @JavascriptInterface public void timer(int seconds){
        Intent t = new Intent(AlarmClock.ACTION_SET_TIMER);
        t.putExtra(AlarmClock.EXTRA_LENGTH, Math.max(1, seconds));
        t.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        safeStart(t);
    }

    /* ---------------- navigation ---------------- */
    @JavascriptInterface public void goBack(){ if(act != null) act.runOnUiThread(act::onBackPressed); }

    /* ---------------- info for the web UI ---------------- */
    @JavascriptInterface public String device(){
        JSONObject o = new JSONObject();
        try {
            o.put("platform","android");
            o.put("sdk", Build.VERSION.SDK_INT);
        }catch(Exception ignored){}
        return o.toString();
    }

    /* ---------------- helpers ---------------- */
    private void safeStart(Intent i){
        if(i == null) return;
        try { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); act.startActivity(i); }
        catch(ActivityNotFoundException e){
            act.pushJs("window.mayaNativeEvent && window.mayaNativeEvent('noActivity')");
        }
    }
    private String opened(boolean ok){
        try { return new JSONObject().put("opened", ok).toString(); }
        catch(Exception ignored){ return "{}"; }
    }
}

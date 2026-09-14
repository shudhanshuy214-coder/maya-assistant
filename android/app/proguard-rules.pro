# MAYA V1 — proguard rules (default; WebView bridge kept intact)
-keepclassmembers class com.maya.assistant.MayaBridge { @android.webkit.JavascriptInterface <methods>; }
-keepattributes JavascriptInterface

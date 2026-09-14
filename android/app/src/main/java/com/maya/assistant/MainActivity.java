package com.maya.assistant;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;

/**
 * MAYA V1 — MainActivity
 * Hosts the frontend (frontend/index.html) inside a WebView and exposes a
 * tiny, secure JavaScript bridge named `MayaNative`.
 *
 * How the web UI talks to this app:
 *   - JS -> Android  : window.MayaNative.<method>(...)  (addJavascriptInterface)
 *   - Android -> JS  : evaluateJavascript("window.mayaNativeEvent(...)") callbacks
 *
 * Security model:
 *   - The bridge never runs commands, never reads files, never touches SMS/contacts.
 *   - All actions go through official public Intents the OS mediates.
 *   - Nothing is logged; no API key is ever handled here (backend holds it).
 */
public class MainActivity extends Activity implements TextToSpeech.OnInitListener {

    private static final String TAG = "MayaV1";
    private static final int REQ_MIC = 1001;
    private static final String FRONTEND_URL = "file:///android_asset/frontend/index.html";

    private WebView webView;
    private MayaBridge bridge;
    private SpeechRecognizer recognizer;
    private SpeechRecognizer sessionRecognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioManager audioManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(0xFF05060F);
        setContentView(R.layout.activity_main);

        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        webView = findViewById(R.id.webview);
        bridge  = new MayaBridge(this);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setUserAgentString(ws.getUserAgentString() + " MayaV1/1.0");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient(){
            // grants microphone requests coming from the WebView
            @Override
            public void onPermissionRequest(final PermissionRequest request){
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // Runtime microphone permission (explained to user first in the web UI)
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ android.Manifest.permission.RECORD_AUDIO }, REQ_MIC);
        }

        // Bridge setup — MUST be before loading the page
        webView.addJavascriptInterface(bridge, "MayaNative");

        tts = new TextToSpeech(this, this);
        tts.setLanguage(Locale.US);

        webView.loadUrl(FRONTEND_URL);
    }

    /* ================= Text-To-Speech ================= */
    @Override public void onInit(int status){
        ttsReady = (status == TextToSpeech.SUCCESS);
        if(ttsReady){
            tts.setLanguage(Locale.US);
            // let the web page know TTS is ready
            pushJs("window.mayaNativeEvent && window.mayaNativeEvent('ttsReady')");
        }
    }

    /* ================= JS-called helpers ================= */
    public void jsSpeak(final String text){
        if(!ttsReady || text == null || text.isEmpty()) return;
        // let page-status switch to "Speaking…" first
        runOnUiThread(() -> pushJs("window.mayaNativeEvent && window.mayaNativeEvent('speakStart')"));
        HashMap<String,String> params = new HashMap<>();
        tts.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener(){
            @Override public void onStart(String id){}
            @Override public void onDone(String id){
                runOnUiThread(() -> pushJs("window.mayaNativeEvent && window.mayaNativeEvent('speakEnd')"));
            }
            @Override public void onError(String id){
                runOnUiThread(() -> pushJs("window.mayaNativeEvent && window.mayaNativeEvent('speakError')"));
            }
        });
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "maya_utt");
    }

    public void jsStopSpeech(){ if(ttsReady) tts.stop(); }

    /* ================= Speech-to-text ================= */
    public void jsStartListening(){
        if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{ android.Manifest.permission.RECORD_AUDIO }, REQ_MIC);
            pushJs("window.mayaNativeEvent && window.mayaNativeEvent('micPermission','pending')");
            return;
        }
        startRecognition();
    }

    private void startRecognition(){
        if(recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(listener);
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                   RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString());
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizer.startListening(i);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle p){ }
        @Override public void onBeginningOfSpeech(){ }
        @Override public void onRmsChanged(float rms){ }
        @Override public void onBufferReceived(byte[] b){ }
        @Override public void onEndOfSpeech(){ }
        @Override public void onPartialResults(ArrayList<String> partial){ }

        @Override public void onError(int err){
            String code;
            switch(err){
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_NETWORK: code="network"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code="no-match"; break;
                case SpeechRecognizer.ERROR_AUDIO: code="audio-capture"; break;
                case SpeechRecognizer.ERROR_CLIENT: code="client"; break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code="not-allowed"; break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                case SpeechRecognizer.ERROR_SERVER: default: code="server"; break;
            }
            pushJs("window.mayaNativeEvent && window.mayaNativeEvent('sttError','"+code+"')");
        }

        @Override public void onResults(ArrayList<String> results){
            if(results == null || results.isEmpty()){
                pushJs("window.mayaNativeEvent && window.mayaNativeEvent('sttError','no-match')");
                return;
            }
            String text = results.get(0);
            String safe = text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
            pushJs("window.mayaNativeEvent && window.mayaNativeEvent('sttResult','"+safe+"')");
        }
    };

    /* ================= Utility ================= */
    void pushJs(final String code){
        runOnUiThread(() -> webView.evaluateJavascript(code, null));
    }

    public void vibrateMs(int ms){
        try {
            Object vib = getSystemService(VIBRATOR_SERVICE);
            if(vib == null) return;
            if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O){
                ((android.os.Vibrator) vib).vibrate(ms);
            }
        } catch(Exception ignored){}
    }

    public void audioFocusRequest(){
        try {
            if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O){
                audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch(Exception ignored){}
    }

    /* ================= Lifecycle ================= */
    @Override protected void onResume(){
        super.onResume();
        if (recognizer != null) try { recognizer.startListening(new Intent()); } catch(Exception ignored){}
        stopFOne(); // no-op placeholder to keep ordering clear
    }
    private void stopFOne(){ /* intentional no-op */ }

    @Override protected void onPause(){
        super.onPause();
        try{ if(recognizer!=null) recognizer.stopListening(); }catch(Exception ignored){}
        if(ttsReady) tts.stop();
    }

    @Override protected void onDestroy(){
        super.onDestroy();
        if(recognizer != null){ try{ recognizer.destroy(); }catch(Exception ignored){} }
        if(tts != null){ try{ tts.stop(); tts.shutdown(); }catch(Exception ignored){} }
        if(webView != null) webView.destroy();
    }
}

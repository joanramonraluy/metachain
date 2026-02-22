package com.metachain.app;

import android.os.Bundle;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.view.View;
import android.view.ViewGroup;
import android.graphics.Rect;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeWebChromeClient;

import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import org.json.JSONArray;

public class MainActivity extends BridgeActivity {
    private static final String PREF_CACHED_UID = "cached_metachain_uid";
    private static final int MAX_RETRIES = 5;
    private static final int RETRY_DELAY_MS = 3000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Theme the Android Navigation Bar to match the app's dynamic theme
        Window window = getWindow();
        
        // Edge-to-edge: This allows the app content to draw behind the status and navigation bars,
        // which is necessary for the semi-transparent (alpha) color to show what's behind it.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        // CRITICAL: TRANSLUCENT_NAVIGATION must be OFF for setNavigationBarColor() to support custom alpha/colors.
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        
        // Explicitly set the color from our resources (includes 40% alpha)
        window.setNavigationBarColor(ContextCompat.getColor(this, R.color.navigationBarColor));
        
        // Detect if dark mode is active to set icon color
        int nightModeFlags = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        boolean isDarkMode = nightModeFlags == android.content.res.Configuration.UI_MODE_NIGHT_YES;

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            // If dark mode is active, icons should be light (false). If not, icons should be dark (true).
            controller.setAppearanceLightNavigationBars(!isDarkMode);
        }




        final WebView webView = getBridge().getWebView();

        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }
        });

        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Let Capacitor handle the WebView resizing instead of overriding it manually.

        discoverMiniDappUid();
        handleSSL();
    }

    private void handleSSL() {
        try {
            javax.net.ssl.TrustManager[] trustAllCerts = new javax.net.ssl.TrustManager[] {
                    new javax.net.ssl.X509TrustManager() {
                        public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                            return new java.security.cert.X509Certificate[] {};
                        }

                        public void checkClientTrusted(java.security.cert.X509Certificate[] certs, String authType) {
                        }

                        public void checkServerTrusted(java.security.cert.X509Certificate[] certs, String authType) {
                        }
                    }
            };

            javax.net.ssl.SSLContext sc = javax.net.ssl.SSLContext.getInstance("SSL");
            sc.init(null, trustAllCerts, new java.security.SecureRandom());
            javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
            javax.net.ssl.HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
            Log.d("MainActivity", "🔓 Global SSL Validation Disabled for Native Proxy");
        } catch (Exception e) {
            Log.e("MainActivity", "❌ Failed to disable SSL validation", e);
        }
    }

    private void discoverMiniDappUid() {
        SharedPreferences prefs = getSharedPreferences("metachain", MODE_PRIVATE);
        String cachedUid = prefs.getString(PREF_CACHED_UID, null);

        if (cachedUid != null) {
            Log.d("MainActivity", "📦 Loading cached UID: " + cachedUid);
            loadWebViewWithUid(cachedUid, null, null);
        }

        new Thread(() -> {
            String discoveredUid = null;
            String mdsConnect = null;

            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    Log.d("MainActivity", "🔍 RPC Discovery attempt " + attempt + "/" + MAX_RETRIES);

                    // Dual Protocol Probe (Port 9005)
                    String[] protocols = { "http", "https" };
                    String[] commands = { "mds", "minidapps" };
                    String rawResponse = null;
                    String successfulCmd = null;

                    for (String proto : protocols) {
                        for (String cmd : commands) {
                            try {
                                String rpcUrl = proto + "://127.0.0.1:9005/" + cmd;
                                URL url = new URL(rpcUrl);
                                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                                conn.setConnectTimeout(5000);
                                conn.setReadTimeout(5000);

                                if (conn.getResponseCode() == 200) {
                                    BufferedReader br = new BufferedReader(
                                            new InputStreamReader(conn.getInputStream()));
                                    StringBuilder rb = new StringBuilder();
                                    String l;
                                    while ((l = br.readLine()) != null)
                                        rb.append(l);

                                    JSONObject json = new JSONObject(rb.toString());
                                    if (json.optBoolean("status", false)) {
                                        rawResponse = rb.toString();
                                        successfulCmd = cmd;
                                        Log.d("MainActivity", "✅ [RPC] Success via " + proto + " [" + cmd + "]");
                                        conn.disconnect();
                                        break;
                                    }
                                }
                                conn.disconnect();
                            } catch (Exception e) {
                                Log.w("MainActivity",
                                        "⚠️ Discovery fail (" + proto + "/" + cmd + "): " + e.getMessage());
                            }
                        }
                        if (rawResponse != null)
                            break;
                    }

                    if (rawResponse != null) {
                        JSONObject json = new JSONObject(rawResponse);
                        JSONArray dapps = null;
                        JSONObject respObj = json.optJSONObject("response");

                        if (respObj != null) {
                            dapps = respObj.optJSONArray("minidapps");
                            if (dapps == null && json.opt("response") instanceof JSONArray) {
                                dapps = json.getJSONArray("response");
                            }
                            if (successfulCmd.equals("mds")) {
                                mdsConnect = respObj.optString("connect", null);
                            }
                        }

                        if (dapps != null) {
                            for (int i = 0; i < dapps.length(); i++) {
                                JSONObject dapp = dapps.getJSONObject(i);
                                JSONObject conf = dapp.optJSONObject("conf");
                                String name = conf != null ? conf.optString("name") : dapp.optString("name");
                                if ("MetaChain".equalsIgnoreCase(name)) {
                                    // Use 'sessionid' (long UID) for external connections, fallback to 'uid'
                                    discoveredUid = dapp.optString("sessionid", null);
                                    if (discoveredUid == null) {
                                        discoveredUid = dapp.optString("uid", null);
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    if (discoveredUid != null) {
                        Log.d("MainActivity", "✅ Discovered UID: " + discoveredUid);
                        final String fUid = discoveredUid;
                        final String fMds = mdsConnect;

                        // Update cache only if valid discovery
                        if (!fUid.equals(cachedUid)) {
                            prefs.edit().putString(PREF_CACHED_UID, fUid).apply();
                        }

                        runOnUiThread(() -> loadWebViewWithUid(fUid, fMds, fUid));
                        return;
                    }

                } catch (Exception e) {
                    Log.w("MainActivity", "⚠️ RPC attempt " + attempt + " failed");
                }

                try {
                    Thread.sleep(RETRY_DELAY_MS);
                } catch (Exception ignored) {
                }
            }
        }).start();
    }

    private void loadWebViewWithUid(String uid, String mds, String rpcUid) {
        String url = "http://localhost/index.html?uid=" + uid;
        if (mds != null)
            url += "&mds_host=" + mds;
        if (rpcUid != null)
            url += "&rpc_uid=" + rpcUid;

        Log.d("MainActivity", "🚀 Loading WebView: " + url);
        getBridge().getWebView().loadUrl(url);
    }
}

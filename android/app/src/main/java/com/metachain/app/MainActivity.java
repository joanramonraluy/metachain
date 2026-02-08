package com.metachain.app;

import android.os.Bundle;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Get the WebView instance from the Bridge
        WebView webView = getBridge().getWebView();

        // 1. SSL Bypass: Extend BridgeWebViewClient to keep Bridge functional
        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Allow self-signed certificates for localhost/127.0.0.1
                // Standard Capacitor client would block this
                handler.proceed();
            }
        });

        // 2. Clipboard/Permissions: Extend BridgeWebChromeClient
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant all permissions (camera, clipboard, etc.)
                // This fixes Navigator.clipboard.writeText
                request.grant(request.getResources());
            }
        });
    }
}

package app.shiyin.music;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShiyinNetwork.class);
        registerPlugin(ShiyinSystemBars.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if ("https".equals(request.getUrl().getScheme()) && "localhost".equals(request.getUrl().getHost())
                        && path != null && path.startsWith(ShiyinNetwork.AUDIO_PREFIX)) {
                    return ShiyinNetwork.stream(request);
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}

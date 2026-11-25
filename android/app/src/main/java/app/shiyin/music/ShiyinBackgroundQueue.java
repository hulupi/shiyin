package app.shiyin.music;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Context;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;
import android.os.Bundle;
import java.io.ByteArrayInputStream;
import java.util.UUID;

/** A service-owned source host. It is never paused with the Activity. */
@UnstableApi
final class ShiyinBackgroundQueue {
    private static final String ORIGIN = "https://shiyin-background.local";
    private final Player player;
    private final Handler main;
    private final WebView host;
    private final android.os.PowerManager.WakeLock workLock;
    private final JSONObject config;
    private final JSONArray tracks;
    private final ShiyinNetwork network = new ShiyinNetwork();
    private boolean ready, busy, closed;
    private int token, attempts, skipped;
    private JSONObject requested;
    private boolean replacing;
    private long resumePosition;
    private String lastTrackId;
    private String forcedId;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (closed) return;
            long duration = player.getDuration();
            if (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_READY
                    && duration > 0 && duration - player.getCurrentPosition() < 30000) prefetch();
            main.postDelayed(this, 2000);
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    ShiyinBackgroundQueue(Context context, Player player, JSONObject config) {
        this.player = player;
        this.lastTrackId = currentId();
        this.config = config;
        forcedId = config.optString("nextId");
        android.os.PowerManager power = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
        workLock = power.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "shiyin:source-resolution");
        workLock.setReferenceCounted(false);
        this.tracks = config.optJSONArray("tracks") == null ? new JSONArray() : config.optJSONArray("tracks");
        this.main = new Handler(player.getApplicationLooper());
        host = new WebView(context);
        if (android.os.Build.VERSION.SDK_INT >= 26) host.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        host.getSettings().setJavaScriptEnabled(true);
        host.getSettings().setDomStorageEnabled(true);
        host.getSettings().setAllowFileAccess(false);
        host.getSettings().setAllowContentAccess(false);
        host.addJavascriptInterface(this, "ShiyinBackground");
        host.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if (ORIGIN.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost())
                        && path != null && !path.contains("..")) {
                    try {
                        String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".wasm")
                            ? "application/wasm" : path.endsWith(".html") ? "text/html" : "application/octet-stream";
                        return new WebResourceResponse(mime, "UTF-8", context.getAssets().open("public" + path));
                    } catch (Exception ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        host.loadUrl(ORIGIN + "/playback-background.html");
        main.postDelayed(tick, 2000);
    }

    @JavascriptInterface public String config() { return config.toString(); }

    @JavascriptInterface public void request(int id, String method, String options) {
        try {
            PluginCall call = new PluginCall(null, "ShiyinNetwork", String.valueOf(id), method, new JSObject(options)) {
                @Override public void resolve(JSObject value) { reply(id, value, ""); }
                @Override public void reject(String message, String code, Exception error, JSObject data) {
                    reply(id, null, message);
                }
            };
            if ("request".equals(method)) network.request(call);
            else if ("audio".equals(method)) network.audio(call);
            else reply(id, null, "Unsupported method");
        } catch (Exception error) { reply(id, null, "Invalid request"); }
    }

    private void reply(int id, JSObject value, String error) {
        main.post(() -> {
            if (!closed) host.evaluateJavascript("globalThis.shiyinBackgroundReply(" + id + ","
                + (value == null ? "null" : value.toString()) + "," + JSONObject.quote(error) + ")", null);
        });
    }

    private String currentId() {
        MediaItem item = player.getCurrentMediaItem();
        Bundle extras = item == null ? null : item.mediaMetadata.extras;
        return extras == null ? "" : extras.getString(ShiyinPlaybackService.TRACK_ID, "");
    }

    private JSONObject nextTrack(String after) {
        if (tracks.length() == 0) return null;
        if (!forcedId.isEmpty()) {
            String forced = forcedId;
            forcedId = "";
            for (int i = 0; i < tracks.length(); i++) {
                if (tracks.optJSONObject(i).optString("id").equals(forced)) return tracks.optJSONObject(i);
            }
        }
        int index = -1;
        for (int i = 0; i < tracks.length(); i++) {
            if (tracks.optJSONObject(i).optString("id").equals(after)) { index = i; break; }
        }
        int next = ShiyinQueueOrder.next(index, tracks.length(), config.optString("mode"), new java.util.Random());
        return next < 0 ? null : tracks.optJSONObject(next);
    }

    void prefetch() {
        if (closed || !ready || busy || player.hasNextMediaItem() || !player.getPlayWhenReady()) return;
        int previous = player.getCurrentMediaItemIndex();
        if (previous > 0) player.removeMediaItems(0, previous);
        JSONObject next = nextTrack(currentId());
        if (next != null) resolve(next, false);
    }

    void ended() { prefetch(); }

    void skip() {
        if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); player.play(); return; }
        cancel();
        JSONObject next = nextTrack(currentId());
        if (next != null) resolve(next, true);
    }

    void playing() { skipped = 0; }

    void transitioned() {
        String id = currentId();
        if (!id.equals(lastTrackId)) { attempts = 0; lastTrackId = id; }
        // Preserve the request metadata until the result callback finishes.

    }

    void error() {
        cancel();
        JSONObject current = null;
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.optJSONObject(i);
            if (track.optString("id").equals(currentId())) { current = track; break; }
        }
        if (current != null && attempts++ < 2) resolve(current, true);
        else if (++skipped >= Math.max(1, tracks.length())) player.pause();
        else skip();
    }

    private void cancel() { token++; busy = false; if (workLock.isHeld()) workLock.release(); }

    private void resolve(JSONObject track, boolean replace) {
        if (closed) return;
        requested = track;
        replacing = replace;
        resumePosition = replace && track.optString("id").equals(currentId()) ? player.getCurrentPosition() : 0;
        workLock.acquire(65000);
        busy = true;
        int requestToken = ++token;
        if (ready) dispatch(requestToken);
        main.postDelayed(() -> {
            if (!closed && busy && token == requestToken) resolved(requestToken, "", "后台取链超时");
        }, 60000);
    }

    private void dispatch(int requestToken) {
        host.evaluateJavascript("globalThis.shiyinResolve(" + requestToken + "," + requested.toString()
            + "," + JSONObject.quote(config.optString("quality", "320k")) + ")", null);
    }

    @JavascriptInterface public void resolved(int requestToken, String result, String error) {
        main.post(() -> {
            if (closed) return;
            if (requestToken == 0) {
                ready = true;
                if (busy) dispatch(token); else prefetch();
                return;
            }
            if (requestToken != token || !busy) return;
            busy = false;
            if (workLock.isHeld()) workLock.release();
            try {
                if (!error.isEmpty()) throw new Exception(error);
                JSONObject value = new JSONObject(result);
                Bundle extras = new Bundle();
                extras.putString(ShiyinPlaybackService.TRACK_ID, requested.optString("id"));
                MediaItem item = new MediaItem.Builder().setMediaId(UUID.randomUUID().toString())
                    .setUri(ShiyinNetwork.mediaUri(value.getString("audioUrl")))
                    .setMediaMetadata(new MediaMetadata.Builder().setTitle(requested.optString("title"))
                        .setArtist(requested.optString("artist")).setAlbumTitle(requested.optString("album"))
                        .setExtras(extras).build()).build();
                boolean wanted = player.getPlayWhenReady();
                if (replacing) { player.setMediaItem(item, resumePosition); player.prepare(); }
                else {
                    boolean ended = player.getPlaybackState() == Player.STATE_ENDED;
                    player.addMediaItem(item);
                    if (ended && player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); }
                }
                if (wanted) player.play();
                Log.i("ShiyinPlayback", "Background source ready: " + requested.optString("id"));
            } catch (Exception failure) {
                Log.w("ShiyinPlayback", "Background resolve failed: " + requested.optString("id") + ": " + failure.getMessage());
                if (++skipped >= Math.max(1, tracks.length())) { player.pause(); return; }
                JSONObject next = nextTrack(requested.optString("id"));
                if (next != null) resolve(next, replacing); else player.pause();
            }
        });
    }

    void close() {
        closed = true;
        if (workLock.isHeld()) workLock.release();
        main.removeCallbacksAndMessages(null);
        host.removeJavascriptInterface("ShiyinBackground");
        host.destroy();
    }
}

package app.shiyin.music;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.IOException;
import java.util.function.Consumer;

@UnstableApi
@CapacitorPlugin(name = "ShiyinPlayback")
public final class ShiyinPlayback extends Plugin {
    private ListenableFuture<MediaController> connection;
    private final Player.Listener observer = new Player.Listener() {
        @Override public void onEvents(@NonNull Player player, @NonNull Player.Events events) {
            notifyListeners("state", snapshot(player));
        }
    };

    private void withPlayer(PluginCall call, Consumer<MediaController> action) {
        getBridge().executeOnMainThread(() -> {
            if (connection == null) {
                SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), ShiyinPlaybackService.class));
                connection = new MediaController.Builder(getContext(), token).buildAsync();
                ListenableFuture<MediaController> opened = connection;
                opened.addListener(() -> {
                    try { opened.get().addListener(observer); }
                    catch (Exception ignored) { if (connection == opened) connection = null; }
                }, ContextCompat.getMainExecutor(getContext()));
            }
            ListenableFuture<MediaController> pending = connection;
            pending.addListener(() -> {
                try { action.accept(pending.get()); }
                catch (Exception error) { call.reject("安卓播放器暂不可用"); }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    private static JSObject snapshot(Player player) {
        JSObject state = new JSObject();
        MediaItem item = player.getCurrentMediaItem();
        state.put("id", item == null ? "" : item.mediaId);
        state.put("playing", player.isPlaying());
        state.put("buffering", player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING);
        state.put("ended", player.getPlaybackState() == Player.STATE_ENDED);
        // The service advances past a failed item when it has another item ready.
        state.put("failed", player.getPlayerError() != null
            && !(player.getPlayWhenReady() && player.hasNextMediaItem()));
        state.put("position", player.getCurrentPosition() / 1000.0);
        state.put("duration", player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration() / 1000.0);
        return state;
    }

    private static MediaItem mediaItem(PluginCall call) throws IOException {
        Uri uri = ShiyinNetwork.mediaUri(call.getString("path", ""));
        Bundle extras = new Bundle();
        extras.putString(ShiyinPlaybackService.TRACK_ID, call.getString("trackId", ""));
        MediaMetadata.Builder metadata = new MediaMetadata.Builder().setExtras(extras)
            .setTitle(call.getString("title", "")).setArtist(call.getString("artist", ""))
            .setAlbumTitle(call.getString("album", ""));
        String artwork = call.getString("artwork", "");
        if (artwork.startsWith("https://")) metadata.setArtworkUri(Uri.parse(artwork));
        return new MediaItem.Builder().setUri(uri).setMediaId(call.getString("id", ""))
            .setMediaMetadata(metadata.build()).build();
    }

    @PluginMethod public void start(PluginCall call) {
        MediaItem item;
        try { item = mediaItem(call); }
        catch (IOException error) { call.reject("音频地址已失效，请重新播放"); return; }
        withPlayer(call, player -> {
            player.setMediaItem(item, Math.max(0, Math.round(call.getDouble("position", 0.0) * 1000)));
            player.setVolume(call.getFloat("volume", 1.0f));
            player.prepare();
            player.play();
            call.resolve();
        });
    }

    @PluginMethod public void clearUpcoming(PluginCall call) {
        withPlayer(call, player -> {
            MediaItem current = player.getCurrentMediaItem();
            boolean applied = current != null && current.mediaId.equals(call.getString("currentId"));
            if (applied) {
                int index = player.getCurrentMediaItemIndex() + 1;
                if (index < player.getMediaItemCount()) player.removeMediaItems(index, player.getMediaItemCount());
            }
            JSObject result = new JSObject();
            result.put("applied", applied);
            call.resolve(result);
        });
    }

    @PluginMethod public void append(PluginCall call) {
        MediaItem upcoming;
        try { upcoming = mediaItem(call); }
        catch (IOException error) { call.reject("下一首音频地址已失效"); return; }
        withPlayer(call, player -> {
            int count = player.getMediaItemCount();
            boolean applied = count > 0 && player.getMediaItemAt(count - 1).mediaId.equals(call.getString("afterId"));
            if (applied) {
                int previous = player.getCurrentMediaItemIndex();
                if (previous > 0) player.removeMediaItems(0, previous);
                boolean resumeAtNext = player.getPlaybackState() == Player.STATE_ENDED
                    && player.getPlayWhenReady();
                player.addMediaItem(upcoming);
                if (resumeAtNext && player.hasNextMediaItem()) player.seekToNextMediaItem();
            }
            JSObject result = new JSObject();
            result.put("applied", applied);
            call.resolve(result);
        });
    }

    @PluginMethod public void control(PluginCall call) {
        withPlayer(call, player -> {
            switch (call.getString("action", "")) {
                case "pause": player.pause(); break;
                case "next": player.seekToNextMediaItem(); break;
                case "play":
                    if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                    if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                    player.play();
                    break;
                case "seek": player.seekTo(Math.max(0, Math.round(call.getDouble("value", 0.0) * 1000))); break;
                case "volume": player.setVolume(call.getFloat("value", 1.0f)); break;
                case "repeat": player.setRepeatMode(call.getBoolean("enabled", false) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF); break;
                default: break;
            }
            call.resolve(snapshot(player));
        });
    }

    @Override protected void handleOnDestroy() {
        if (connection != null) MediaController.releaseFuture(connection);
        super.handleOnDestroy();
    }
}

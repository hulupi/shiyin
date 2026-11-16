package app.shiyin.music;

import android.app.PendingIntent;
import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

@UnstableApi
public final class ShiyinPlaybackService extends MediaSessionService {
    private MediaSession session;

    @Override public void onCreate() {
        super.onCreate();
        OkHttpDataSource.Factory network = new OkHttpDataSource.Factory(ShiyinNetwork.mediaClient())
            .setUserAgent("Mozilla/5.0");
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(network))
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        PendingIntent activity = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity).build();
    }

    @Override public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}

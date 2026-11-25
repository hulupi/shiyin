package app.shiyin.music;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import androidx.annotation.NonNull;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.Collections;

@UnstableApi
public final class ShiyinPlaybackService extends MediaSessionService {
    static final String TRACK_ID = "shiyinTrackId";
    private static final SessionCommand FAVORITE = new SessionCommand("shiyin.favorite.add", Bundle.EMPTY);
    private static final SessionCommand UNFAVORITE = new SessionCommand("shiyin.favorite.remove", Bundle.EMPTY);
    static ShiyinPlaybackService active;
    private ShiyinBackgroundQueue backgroundQueue;
    private MediaSession session;
    void configureQueue(org.json.JSONObject config) {
        if (backgroundQueue != null) backgroundQueue.close();
        Player player = session.getPlayer();
        int upcoming = player.getCurrentMediaItemIndex() + 1;
        if (upcoming < player.getMediaItemCount()) player.removeMediaItems(upcoming, player.getMediaItemCount());
        backgroundQueue = new ShiyinBackgroundQueue(this, player, config);
    }
    void stopBackground() { if (backgroundQueue != null) { backgroundQueue.close(); backgroundQueue = null; } }
    void skipBackground() { if (backgroundQueue != null) backgroundQueue.skip(); }
    boolean ownsQueue() { return backgroundQueue != null; }
    private int recoveryAttempts;
    private boolean recovering;

    private SharedPreferences favorites;
    private final SharedPreferences.OnSharedPreferenceChangeListener favoriteChanges = (storage, key) -> {
        if (ShiyinFavorites.KEY.equals(key)) updateFavoriteButton();
    };

    @Override public void onCreate() {
        super.onCreate();
        active = this;
        favorites = ShiyinFavorites.store(this);
        OkHttpDataSource.Factory network = new OkHttpDataSource.Factory(ShiyinNetwork.mediaClient())
            .setUserAgent("Mozilla/5.0");
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(network))
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        Handler playbackHandler = new Handler(player.getApplicationLooper());
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                if (backgroundQueue != null) backgroundQueue.transitioned();
                recoveryAttempts = 0;
                recovering = false;
                updateFavoriteButton();
            }

            @Override public void onIsPlayingChanged(boolean playing) {
                if (playing && backgroundQueue != null) backgroundQueue.playing();
            }
            @Override public void onPlaybackStateChanged(int state) {
                if (backgroundQueue != null && state == Player.STATE_ENDED) backgroundQueue.ended();
            }
            @Override public void onPlayerError(@NonNull PlaybackException error) {
                if (backgroundQueue != null) {
                    if (player.getPlayWhenReady()) backgroundQueue.error();
                    return;
                }
                if (!player.getPlayWhenReady()) return;
                // Recover in the service even when the UI JavaScript is suspended.
                boolean retry = recoveryAttempts++ < 2;
                recovering = retry || player.hasNextMediaItem();
                if (!recovering) {
                    player.pause();
                    return;
                }
                playbackHandler.postDelayed(() -> {
                    if (session == null || player.getPlayerError() != error) return;
                    recovering = false;
                    if (!player.getPlayWhenReady()) return;
                    if (!retry) {
                        if (!player.hasNextMediaItem()) return;
                        player.seekToNextMediaItem();
                    }
                    player.prepare();
                    player.play();
                }, retry ? recoveryAttempts * 1500L : 0L);
            }
        });
        PendingIntent activity = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity)
            .setCallback(new MediaSession.Callback() {
                @Override public MediaSession.ConnectionResult onConnect(
                    MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                        .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                            .add(FAVORITE).add(UNFAVORITE).build())
                        .build();
                }

                @Override public ListenableFuture<SessionResult> onCustomCommand(MediaSession mediaSession,
                    MediaSession.ControllerInfo controller, SessionCommand command, Bundle args) {
                    String id = currentTrackId();
                    if (id.isEmpty() || (!FAVORITE.equals(command) && !UNFAVORITE.equals(command))) {
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE));
                    }
                    boolean alreadyFavorite = ShiyinFavorites.tracks(favorites).contains(id);
                    if (alreadyFavorite == UNFAVORITE.equals(command)) ShiyinFavorites.toggle(favorites, id);
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                }
            }).build();
        favorites.registerOnSharedPreferenceChangeListener(favoriteChanges);
    }

    private String currentTrackId() {
        MediaItem item = session == null ? null : session.getPlayer().getCurrentMediaItem();
        Bundle extras = item == null ? null : item.mediaMetadata.extras;
        return extras == null ? "" : extras.getString(TRACK_ID, "");
    }

    private void updateFavoriteButton() {
        if (session == null) return;
        String id = currentTrackId();
        if (id.isEmpty()) {
            session.setMediaButtonPreferences(Collections.emptyList());
            return;
        }
        boolean favorite = ShiyinFavorites.tracks(favorites).contains(id);
        CommandButton.Builder icon = favorite
            ? new CommandButton.Builder(CommandButton.ICON_UNDEFINED).setCustomIconResId(R.drawable.ic_media_favorite_filled)
            : new CommandButton.Builder(CommandButton.ICON_HEART_UNFILLED);
        CommandButton button = icon.setDisplayName(favorite ? "取消收藏" : "收藏")
            .setSessionCommand(favorite ? UNFAVORITE : FAVORITE)
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build();
        session.setMediaButtonPreferences(Collections.singletonList(button));
    }

    @Override public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override public void onDestroy() {
        active = null;
        if (backgroundQueue != null) { backgroundQueue.close(); backgroundQueue = null; }
        if (favorites != null) favorites.unregisterOnSharedPreferenceChangeListener(favoriteChanges);
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}

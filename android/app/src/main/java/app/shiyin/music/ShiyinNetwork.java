package app.shiyin.music;

import android.net.Uri;
import android.security.NetworkSecurityPolicy;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "ShiyinNetwork")
public final class ShiyinNetwork extends Plugin {
    static final String AUDIO_PREFIX = "/_shiyin_audio/";
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final ExecutorService IO = Executors.newFixedThreadPool(6);
    private static final Map<String, HttpUrl> AUDIO = new LinkedHashMap<>();
    private static final OkHttpClient NETWORK = new OkHttpClient.Builder()
        .dns(ShiyinNetwork::resolvePublic)
        .proxy(Proxy.NO_PROXY)
        .followRedirects(false)
        .callTimeout(25, TimeUnit.SECONDS)
        .build();
    private static final OkHttpClient HTTPS = NETWORK.newBuilder()
        .addInterceptor(chain -> followPublicRedirects(chain, false))
        .build();
    private static final OkHttpClient MEDIA = NETWORK.newBuilder()
        .addInterceptor(chain -> followPublicRedirects(chain, true))
        .callTimeout(0, TimeUnit.SECONDS)
        .build();
    private static final OkHttpClient PROBE = MEDIA.newBuilder().callTimeout(5000, TimeUnit.MILLISECONDS).build();

    private static List<InetAddress> resolvePublic(String host) throws UnknownHostException {
        List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
        for (InetAddress address : addresses) {
            byte[] bytes = address.getAddress();
            int first = bytes[0] & 255;
            int second = bytes[1] & 255;
            boolean nonPublic = bytes.length == 4
                ? first == 0 || first >= 224 || (first == 100 && second >= 64 && second <= 127)
                : (first & 0xe0) != 0x20;
            if (nonPublic || address.isAnyLocalAddress() || address.isLoopbackAddress()
                    || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                throw new UnknownHostException("不允许访问本地网络");
            }
        }
        return addresses;
    }

    private static HttpUrl publicUrl(String value, boolean media) throws IOException {
        HttpUrl url = value == null ? null : HttpUrl.parse(value);
        if (url == null || !url.username().isEmpty() || !url.password().isEmpty()
                || url.host().matches("[0-9.]+") || url.host().contains(":")) {
            throw new IOException("需要公开的音频或接口地址");
        }
        if (!url.isHttps() && (!media || !NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(url.host()))) {
            throw new IOException("该 HTTP 音频域名尚未开放");
        }
        return url;
    }

    static OkHttpClient mediaClient() { return MEDIA; }

    static Uri mediaUri(String path) throws IOException {
        if (!path.startsWith(AUDIO_PREFIX)) throw new IOException("Invalid audio path");
        synchronized (AUDIO) {
            HttpUrl url = AUDIO.get(path.substring(AUDIO_PREFIX.length()));
            if (url == null) throw new IOException("Unknown audio path");
            return Uri.parse(url.toString());
        }
    }

    private static Response followPublicRedirects(Interceptor.Chain chain, boolean media) throws IOException {
        Request request = chain.request();
        for (int i = 0; i < 5; i++) {
            publicUrl(request.url().toString(), media);
            Response response = chain.proceed(request);
            String location = response.header("Location");
            int code = response.code();
            if (location == null || !(code == 301 || code == 302 || code == 303 || code == 307 || code == 308)) {
                return response;
            }
            response.close();
            HttpUrl target = request.url().resolve(location);
            target = publicUrl(target == null ? null : target.toString(), media);
            Request.Builder next = request.newBuilder().url(target);
            if (!target.host().equals(request.url().host()) || target.port() != request.url().port() || !target.scheme().equals(request.url().scheme())) {
                next.removeHeader("Authorization").removeHeader("Cookie");
            }
            if (code == 303 || ((code == 301 || code == 302) && request.method().equals("POST"))) next.get();
            request = next.build();
        }
        throw new IOException("重定向次数过多");
    }

    @PluginMethod
    public void request(PluginCall call) {
        IO.execute(() -> {
            try {
                Request.Builder builder = new Request.Builder().url(publicUrl(call.getString("url"), false))
                    .header("User-Agent", "Mozilla/5.0");
                JSObject headers = call.getObject("headers", new JSObject());
                headers.keys().forEachRemaining(name -> {
                    if (!name.matches("(?i)host|connection|content-length|transfer-encoding|accept-encoding|proxy-.*")) {
                        builder.header(name, headers.optString(name));
                    }
                });
                String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
                String body = call.getString("body");
                RequestBody data = body == null ? null : RequestBody.create(Base64.decode(body, Base64.DEFAULT), null);
                if (data == null && (method.equals("POST") || method.equals("PUT") || method.equals("PATCH"))) {
                    data = RequestBody.create(new byte[0], null);
                }
                int limit = Math.max(1, Math.min(MAX_BYTES, call.getInt("limit", MAX_BYTES)));
                int timeout = Math.max(1000, Math.min(25000, call.getInt("timeout", 25000)));
                OkHttpClient client = HTTPS.newBuilder().callTimeout(timeout, TimeUnit.MILLISECONDS).build();
                try (Response response = client.newCall(builder.method(method, data).build()).execute()) {
                    JSObject responseHeaders = new JSObject();
                    for (String name : response.headers().names()) {
                        responseHeaders.put(name.toLowerCase(Locale.ROOT), response.header(name));
                    }
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    ResponseBody responseBody = response.body();
                    if (responseBody != null) {
                        try (InputStream input = responseBody.byteStream()) {
                            byte[] chunk = new byte[8192];
                            int count;
                            while ((count = input.read(chunk)) != -1) {
                                if (output.size() + count > limit) throw new IOException("在线响应过大");
                                output.write(chunk, 0, count);
                            }
                        }
                    }
                    JSObject result = new JSObject();
                    result.put("statusCode", response.code());
                    result.put("headers", responseHeaders);
                    result.put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    call.resolve(result);
                }
            } catch (IOException | IllegalArgumentException error) {
                call.reject("在线请求失败，请检查网络或稍后重试");
            }
        });
    }

    @PluginMethod
    public void audio(PluginCall call) {
        IO.execute(() -> probeAudio(call));
    }

    private static void probeAudio(PluginCall call) {
        try {
            HttpUrl url = publicUrl(call.getString("url"), true);
            Request request = new Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0")
                .header("Range", "bytes=0-1")
                .header("Accept-Encoding", "identity")
                .build();
            try (Response response = PROBE.newCall(request).execute()) {
                if (!isAudio(response)) throw new IOException("链接无法播放");
            }
            String id = UUID.randomUUID().toString();
            synchronized (AUDIO) {
                AUDIO.put(id, url);
                while (AUDIO.size() > 16) AUDIO.remove(AUDIO.keySet().iterator().next());
            }
            JSObject result = new JSObject();
            result.put("path", AUDIO_PREFIX + id);
            call.resolve(result);
        } catch (IOException error) {
            call.reject(error.getMessage());
        }
    }

    private static boolean isAudio(Response response) {
        String type = response.header("Content-Type", "application/octet-stream");
        return response.isSuccessful() && response.body() != null
            && !type.matches("(?i)text/.*|.*(?:json|xml|html).*");
    }
}

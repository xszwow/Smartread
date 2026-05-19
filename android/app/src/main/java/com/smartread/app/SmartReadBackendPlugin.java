package com.smartread.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.activity.result.ActivityResult;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "SmartReadBackend",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class SmartReadBackendPlugin extends Plugin {
    private static final String PREFS = "smartread_native_backend";
    private static final String USER_EMAIL = "user_email";
    private static final String ZLIB_EMAIL = "zlib_email";
    private static final String ZLIB_COOKIES = "zlib_cookies";
    private static final String ZLIB_MIRROR = "zlib_mirror";
    private static final String AI_BASE_URL = "ai_base_url";
    private static final String AI_API_KEY = "ai_api_key";
    private static final String AI_MODEL = "ai_model";
    private static final String BOOKS = "books";
    private static final String JOBS = "jobs";
    private static final String DEFAULT_AI_URL = "https://api.openai.com/v1/chat/completions";
    private static final String DEFAULT_AI_MODEL = "gpt-5.5";
    private static final String LOCAL_USER_EMAIL = "local-device@smartread.local";
    private static final String[] MIRRORS = new String[] { "https://z-lib.fm", "https://z-library.sk", "https://z-library.is" };
    private static final String[] LOGIN_MIRRORS = new String[] { "https://z-lib.fm", "https://z-library.sk" };
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private PluginCall activeTtsCall;
    private String activeTtsUtteranceId;

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        ttsReady = false;
        activeTtsCall = null;
        activeTtsUtteranceId = null;
    }

    @PluginMethod
    public void config(PluginCall call) {
        JSObject out = new JSObject();
        out.put("deploymentMode", "android-native-backend");
        out.put("zlibRegisterUrl", "https://z-lib.fm/registration?redirectUrl=https%3A%2F%2Fz-lib.fm%2F");
        out.put("zlibMirror", prefs().getString(ZLIB_MIRROR, MIRRORS[0]));
        JSArray mirrors = new JSArray();
        for (String mirror : MIRRORS) mirrors.put(mirror);
        out.put("zlibMirrors", mirrors);
        JSObject ai = new JSObject();
        ai.put("baseURL", prefs().getString(AI_BASE_URL, DEFAULT_AI_URL));
        ai.put("model", prefs().getString(AI_MODEL, DEFAULT_AI_MODEL));
        out.put("aiDefaults", ai);
        call.resolve(out);
    }

    @PluginMethod
    public void me(PluginCall call) {
        call.resolve(authState());
    }

    @PluginMethod
    public void login(PluginCall call) {
        String email = normalizeEmail(call.getString("email", ""));
        String password = call.getString("password", "");
        if (email.isEmpty() || password.isEmpty()) {
            call.reject("请输入 Z-Library 邮箱和密码");
            return;
        }
        runAsync(call, () -> {
            ZlibSession session = loginZlib(email, password);
            prefs().edit()
                .putString(USER_EMAIL, email)
                .putString(ZLIB_EMAIL, email)
                .putString(ZLIB_COOKIES, session.cookieHeader)
                .putString(ZLIB_MIRROR, session.mirror)
                .apply();
            return authState();
        });
    }

    @PluginMethod
    public void requestEmailCode(PluginCall call) {
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("nativeBackend", true);
        out.put("message", "Android 版使用本机账号，不需要邮箱验证码。请直接绑定 Z-Library。");
        out.put("expiresInMs", 0);
        out.put("cooldownMs", 0);
        call.resolve(out);
    }

    @PluginMethod
    public void verifyEmailCode(PluginCall call) {
        call.resolve(authState());
    }

    @PluginMethod
    public void logout(PluginCall call) {
        prefs().edit().remove(USER_EMAIL).remove(ZLIB_EMAIL).remove(ZLIB_COOKIES).remove(ZLIB_MIRROR).apply();
        call.resolve(authState());
    }

    @PluginMethod
    public void bindZlib(PluginCall call) {
        login(call);
    }

    @PluginMethod
    public void unbindZlib(PluginCall call) {
        prefs().edit().remove(ZLIB_EMAIL).remove(ZLIB_COOKIES).remove(ZLIB_MIRROR).apply();
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("zlibBound", false);
        call.resolve(out);
    }

    @PluginMethod
    public void aiConfigStatus(PluginCall call) {
        call.resolve(aiStatus());
    }

    @PluginMethod
    public void saveAIConfig(PluginCall call) {
        String baseURL = call.getString("baseURL", DEFAULT_AI_URL).trim();
        String apiKey = call.getString("apiKey", "").trim();
        String model = call.getString("model", DEFAULT_AI_MODEL).trim();
        String existingKey = prefs().getString(AI_API_KEY, "");
        if (!baseURL.startsWith("http://") && !baseURL.startsWith("https://")) {
            call.reject("API Base URL 必须是 http/https 地址");
            return;
        }
        if (model.isEmpty()) {
            call.reject("请输入模型名称");
            return;
        }
        if (apiKey.isEmpty() && existingKey.isEmpty()) {
            call.reject("请输入 API Key");
            return;
        }
        SharedPreferences.Editor editor = prefs().edit().putString(AI_BASE_URL, baseURL).putString(AI_MODEL, model);
        if (!apiKey.isEmpty()) editor.putString(AI_API_KEY, apiKey);
        editor.apply();
        call.resolve(aiStatus());
    }

    @PluginMethod
    public void aiChat(PluginCall call) {
        runAsync(call, () -> {
            String apiKey = prefs().getString(AI_API_KEY, "");
            if (apiKey.isEmpty()) throw new Exception("请先配置 AI API Key");
            JSONObject payload = new JSONObject();
            payload.put("model", call.getString("model", prefs().getString(AI_MODEL, DEFAULT_AI_MODEL)));
            Object messages = call.getData().opt("messages");
            if (!(messages instanceof JSONArray) || ((JSONArray) messages).length() == 0) {
                throw new Exception("缺少 messages");
            }
            payload.put("messages", messages);
            payload.put("stream", false);
            HttpResult response = request("POST", chatCompletionsUrl(prefs().getString(AI_BASE_URL, DEFAULT_AI_URL)), payload.toString(), Map.of(
                "Content-Type", "application/json",
                "Authorization", "Bearer " + apiKey
            ), null);
            if (response.status < 200 || response.status >= 300) throw new Exception("AI 服务错误 (" + response.status + ")");
            return JSObject.fromJSONObject(new JSONObject(response.text()));
        });
    }

    @PluginMethod
    public void ttsStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("supported", true);
        out.put("ready", ttsReady);
        out.put("nativeBackend", true);
        call.resolve(out);
    }

    @PluginMethod
    public void ttsSpeak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("empty", true);
            call.resolve(out);
            return;
        }
        getActivity().runOnUiThread(() -> ensureTts(call, () -> speakWithTts(call, text)));
    }

    @PluginMethod
    public void ttsStop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (tts != null) tts.stop();
            resolveActiveTts(true);
            JSObject out = new JSObject();
            out.put("ok", true);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void recognizeSpeech(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "recognizeSpeechPermissionCallback");
            return;
        }
        startSpeechRecognizer(call);
    }

    @PermissionCallback
    private void recognizeSpeechPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("麦克风权限被拒绝");
            return;
        }
        startSpeechRecognizer(call);
    }

    @ActivityCallback
    private void recognizeSpeechResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("没有识别到语音");
            return;
        }
        ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = matches == null || matches.isEmpty() ? "" : matches.get(0);
        JSObject out = new JSObject();
        out.put("ok", !text.trim().isEmpty());
        out.put("text", text.trim());
        call.resolve(out);
    }

    @PluginMethod
    public void searchZlib(PluginCall call) {
        String q = call.getString("q", "").trim();
        if (q.isEmpty()) {
            call.reject("请输入搜索关键词");
            return;
        }
        int page = Math.max(1, call.getInt("page", 1));
        String format = call.getString("format", "").trim().toLowerCase(Locale.ROOT);
        runAsync(call, () -> searchZlib(q, page, format));
    }

    @PluginMethod
    public void startZlibDownload(PluginCall call) {
        String sourceId = call.getString("sourceId", "");
        String format = call.getString("format", "");
        JSObject metadata = call.getObject("metadata", new JSObject());
        if (sourceId.isEmpty()) {
            call.reject("缺少书籍来源 ID");
            return;
        }
        runAsync(call, () -> {
            JSONObject job = new JSONObject();
            String jobId = "job_" + UUID.randomUUID();
            job.put("id", jobId);
            job.put("status", "queued");
            job.put("createdAt", System.currentTimeMillis());
            upsertJob(job);
            io.execute(() -> processDownload(jobId, sourceId, format, metadata));
            JSObject out = new JSObject();
            out.put("jobId", jobId);
            out.put("status", "queued");
            return out;
        });
    }

    @PluginMethod
    public void downloadJob(PluginCall call) {
        String jobId = call.getString("jobId", "");
        JSONObject job = findById(readArray(JOBS), jobId);
        if (job == null) {
            call.reject("找不到下载任务");
            return;
        }
        call.resolve(jobPayload(job));
    }

    @PluginMethod
    public void serverBooks(PluginCall call) {
        JSObject out = new JSObject();
        out.put("books", readArray(BOOKS));
        call.resolve(out);
    }

    @PluginMethod
    public void updateBookProgress(PluginCall call) {
        String bookId = call.getString("bookId", "");
        JSONArray books = readArray(BOOKS);
        JSONObject book = findById(books, bookId);
        if (book == null) {
            call.reject("找不到这本书");
            return;
        }
        try {
            book.put("currentPage", call.getInt("currentPage", book.optInt("currentPage", 0)));
            book.put("currentCfi", call.getString("currentCfi", book.optString("currentCfi", null)));
            book.put("progress", clamp(call.getDouble("progress", book.optDouble("progress", 0)), 0, 100));
            book.put("totalPages", call.getInt("totalPages", book.optInt("totalPages", 0)));
            book.put("lastRead", call.getLong("lastRead", System.currentTimeMillis()));
            saveArray(BOOKS, books);
            JSObject out = new JSObject();
            out.put("book", book);
            call.resolve(out);
        } catch (Exception error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void deleteServerBook(PluginCall call) {
        String bookId = call.getString("bookId", "");
        JSONArray books = readArray(BOOKS);
        JSONArray next = new JSONArray();
        for (int i = 0; i < books.length(); i++) {
            JSONObject book = books.optJSONObject(i);
            if (book == null) continue;
            if (!bookId.equals(book.optString("id"))) next.put(book);
            else new File(book.optString("filePath", "")).delete();
        }
        saveArray(BOOKS, next);
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void fetchBookFile(PluginCall call) {
        String bookId = call.getString("bookId", "");
        runAsync(call, () -> {
            JSONObject book = findById(readArray(BOOKS), bookId);
            if (book == null) throw new Exception("找不到这本书");
            File file = new File(book.optString("filePath", ""));
            if (!file.exists()) throw new Exception("文件不存在");
            JSObject out = new JSObject();
            out.put("mimeType", book.optString("mimeType", mimeFor(book.optString("extension", ""))));
            out.put("fileName", book.optString("title", bookId) + "." + book.optString("extension", "bin"));
            out.put("filePath", file.getAbsolutePath());
            out.put("size", file.length());
            return out;
        });
    }

    private JSObject authState() {
        String email = prefs().getString(USER_EMAIL, "");
        String userEmail = email.isEmpty() ? LOCAL_USER_EMAIL : email;
        JSObject out = new JSObject();
        JSObject user = new JSObject();
        user.put("id", "android-" + Integer.toHexString(userEmail.hashCode()));
        user.put("email", userEmail);
        user.put("displayName", email.isEmpty() ? "本机书架" : "Z-Library");
        out.put("user", user);
        out.put("aiConfigured", !prefs().getString(AI_API_KEY, "").isEmpty());
        out.put("zlibBound", !prefs().getString(ZLIB_COOKIES, "").isEmpty());
        out.put("nativeBackend", true);
        return out;
    }

    private JSObject aiStatus() {
        String key = prefs().getString(AI_API_KEY, "");
        JSObject out = new JSObject();
        out.put("configured", !key.isEmpty());
        out.put("baseURL", prefs().getString(AI_BASE_URL, DEFAULT_AI_URL));
        out.put("model", prefs().getString(AI_MODEL, DEFAULT_AI_MODEL));
        out.put("keyPreview", maskKey(key));
        return out;
    }

    private void ensureTts(PluginCall call, Runnable onReady) {
        if (tts != null && ttsReady) {
            onReady.run();
            return;
        }
        if (tts != null) {
            tts.shutdown();
            tts = null;
            ttsReady = false;
        }
        String engine = resolveTtsEngine();
        tts = engine.isEmpty()
            ? new TextToSpeech(getActivity(), status -> onTtsInitialized(call, onReady, status))
            : new TextToSpeech(getActivity(), status -> onTtsInitialized(call, onReady, status), engine);
    }

    private void onTtsInitialized(PluginCall call, Runnable onReady, int status) {
        getActivity().runOnUiThread(() -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) {
                if (tts != null) {
                    tts.shutdown();
                    tts = null;
                }
                call.reject("Android TTS 初始化失败，请在系统设置中启用文字转语音引擎");
                return;
            }
            tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    if (!utteranceId.equals(activeTtsUtteranceId)) return;
                    getActivity().runOnUiThread(() -> resolveActiveTts(false));
                }

                @Override
                public void onError(String utteranceId) {
                    if (!utteranceId.equals(activeTtsUtteranceId)) return;
                    getActivity().runOnUiThread(() -> rejectActiveTts("Android TTS 朗读失败"));
                }
            });
            onReady.run();
        });
    }

    private String resolveTtsEngine() {
        String configured = Settings.Secure.getString(getContext().getContentResolver(), "tts_default_synth");
        if (configured != null && !configured.trim().isEmpty()) return configured.trim();
        List<ResolveInfo> services = getContext().getPackageManager().queryIntentServices(
            new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE),
            0
        );
        if (services != null && !services.isEmpty() && services.get(0).serviceInfo != null) {
            return services.get(0).serviceInfo.packageName;
        }
        return "";
    }

    private void speakWithTts(PluginCall call, String text) {
        resolveActiveTts(true);
        String lang = call.getString("lang", "zh-CN");
        float rate = call.getFloat("rate", 1.0F);
        if (tts == null || !ttsReady) {
            call.reject("Android TTS 不可用");
            return;
        }
        int languageResult = tts.setLanguage(localeFor(lang));
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            languageResult = tts.setLanguage(Locale.getDefault());
        }
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.US);
        }
        tts.setSpeechRate(Math.max(0.5F, Math.min(2.0F, rate)));
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0F);
        String utteranceId = "smartread-" + UUID.randomUUID();
        activeTtsCall = call;
        activeTtsUtteranceId = utteranceId;
        int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        if (result == TextToSpeech.ERROR) {
            activeTtsCall = null;
            activeTtsUtteranceId = null;
            call.reject("Android TTS 启动失败");
        }
    }

    private Locale localeFor(String lang) {
        String value = lang == null ? "" : lang.toLowerCase(Locale.ROOT);
        if (value.startsWith("en")) return Locale.US;
        if (value.startsWith("ja")) return Locale.JAPAN;
        if (value.startsWith("ko")) return Locale.KOREA;
        if (value.startsWith("fr")) return Locale.FRANCE;
        if (value.startsWith("de")) return Locale.GERMANY;
        return Locale.CHINA;
    }

    private void resolveActiveTts(boolean cancelled) {
        PluginCall call = activeTtsCall;
        activeTtsCall = null;
        activeTtsUtteranceId = null;
        if (call == null) return;
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("cancelled", cancelled);
        call.resolve(out);
    }

    private void rejectActiveTts(String message) {
        PluginCall call = activeTtsCall;
        activeTtsCall = null;
        activeTtsUtteranceId = null;
        if (call != null) call.reject(message);
    }

    private void startSpeechRecognizer(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("lang", "zh-CN"));
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "请开始说话");
        startActivityForResult(call, intent, "recognizeSpeechResult");
    }

    private ZlibSession loginZlib(String email, String password) throws Exception {
        Exception last = null;
        for (String mirror : LOGIN_MIRRORS) {
            try {
                String body = "isModal=True&email=" + enc(email) + "&password=" + enc(password) +
                    "&site_mode=books&action=login&isSingleLogin=1&redirectUrl=&gg_json_mode=1";
                HttpResult result = request(
                    "POST",
                    mirror + "/rpc.php",
                    body,
                    Map.of("Content-Type", "application/x-www-form-urlencoded"),
                    null,
                    12000,
                    18000
                );
                String cookies = result.cookieHeader();
                if (result.status == 401 || result.status == 403 || result.status == 429 || result.status >= 500) {
                    throw new Exception("Z-Library 登录镜像不可用：" + mirror + "，HTTP " + result.status);
                }
                if (cookies.contains("remix_userid") || cookies.contains("remix_userkey")) {
                    return new ZlibSession(mirror, cookies);
                }
                last = new Exception("Z-Library 登录失败，请检查账号或镜像");
            } catch (Exception error) {
                last = error;
            }
        }
        throw last == null ? new Exception("Z-Library 登录失败") : last;
    }

    private JSObject searchZlib(String q, int page, String format) throws Exception {
        String cookies = requireZlibCookies();
        String preferred = prefs().getString(ZLIB_MIRROR, MIRRORS[0]);
        Exception lastBlocked = null;
        JSObject lastEmpty = null;
        for (String mirror : orderedMirrors(preferred)) {
            StringBuilder url = new StringBuilder(mirror + "/s/" + enc(q) + "?");
            appendSearchExtensions(url, format);
            url.append("&page=").append(page);
            HttpResult result = request("GET", url.toString(), null, Map.of(), cookies);
            String html = result.text();
            if (isBlockedOrInvalidSearch(result, html)) {
                lastBlocked = new Exception("Z-Library 镜像不可用：" + mirror + "，HTTP " + result.status);
                continue;
            }
            JSONArray items = parseSearch(html, mirror);
            JSObject out = new JSObject();
            int totalPages = parseTotalPages(html);
            out.put("page", page);
            out.put("totalPages", totalPages);
            out.put("hasNext", totalPages > 0 ? page < totalPages : items.length() >= 50);
            out.put("results", items);
            out.put("mirror", mirror);
            prefs().edit().putString(ZLIB_MIRROR, mirror).apply();
            if (items.length() > 0) return out;
            lastEmpty = out;
        }
        if (lastEmpty != null) return lastEmpty;
        throw lastBlocked == null ? new Exception("Z-Library 搜索失败") : lastBlocked;
    }

    private void processDownload(String jobId, String sourceId, String format, JSObject metadata) {
        try {
            updateJob(jobId, "running", null, null);
            String cookies = requireZlibCookies();
            String mirror = prefs().getString(ZLIB_MIRROR, MIRRORS[0]);
            String ext = sanitizeExt(format.isEmpty() ? metadata.getString("extension", "epub") : format);
            String downloadPath = metadata.getString("downloadPath", "");
            String downloadUrl = downloadPath.isEmpty()
                ? downloadUrlFromFormats(mirror, sourceId, ext, cookies)
                : new URL(new URL(mirror), downloadPath).toString();
            HttpResult result = request("GET", downloadUrl, null, Map.of(), cookies);
            if (result.contentType.toLowerCase(Locale.ROOT).contains("text/html") && !downloadPath.isEmpty()) {
                result = request("GET", downloadUrlFromFormats(mirror, sourceId, ext, cookies), null, Map.of(), cookies);
            }
            if (result.contentType.toLowerCase(Locale.ROOT).contains("text/html")) throw new Exception("Z-Library 返回 HTML，下载地址不可用");
            String title = metadata.getString("title", sourceId);
            String bookId = "book_" + UUID.randomUUID();
            File dir = new File(getContext().getFilesDir(), "smartread-books");
            dir.mkdirs();
            File file = new File(dir, bookId + "." + ext);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(result.bytes);
            }
            JSONObject book = new JSONObject();
            book.put("id", bookId);
            book.put("source", "zlib");
            book.put("sourceId", sourceId);
            book.put("title", title);
            book.put("authors", metadata.optJSONArray("authors") == null ? new JSONArray() : metadata.optJSONArray("authors"));
            book.put("coverUrl", metadata.opt("coverUrl"));
            book.put("year", metadata.opt("year"));
            book.put("language", metadata.opt("language"));
            book.put("extension", ext);
            book.put("sizeLabel", metadata.opt("sizeLabel"));
            book.put("mimeType", result.contentType.isEmpty() ? mimeFor(ext) : result.contentType);
            book.put("status", "ready");
            book.put("currentPage", 0);
            book.put("currentCfi", JSONObject.NULL);
            book.put("progress", 0);
            book.put("totalPages", 0);
            book.put("addedAt", System.currentTimeMillis());
            book.put("lastRead", 0);
            book.put("filePath", file.getAbsolutePath());
            JSONArray books = readArray(BOOKS);
            books.put(book);
            saveArray(BOOKS, books);
            updateJob(jobId, "saved", bookId, null);
        } catch (Exception error) {
            updateJob(jobId, "failed", null, error.getMessage());
        }
    }

    private String downloadUrlFromFormats(String mirror, String sourceId, String ext, String cookies) throws Exception {
        HttpResult result = request("GET", mirror + "/papi/book/" + enc(sourceId) + "/formats", null, Map.of(), cookies);
        JSONObject data = new JSONObject(result.text());
        JSONArray formats = data.optJSONArray("books");
        if (formats == null) throw new Exception("没有找到可下载格式");
        for (int i = 0; i < formats.length(); i++) {
            JSONObject item = formats.optJSONObject(i);
            if (item == null) continue;
            if (!ext.equalsIgnoreCase(item.optString("extension"))) continue;
            String href = item.optString("href", "");
            if (href.isEmpty()) continue;
            return absoluteUrl(mirror, href);
        }
        throw new Exception("这本书没有可用的 " + ext.toUpperCase(Locale.ROOT) + " 下载格式");
    }

    private JSONArray parseSearch(String html, String mirror) throws Exception {
        JSONArray results = new JSONArray();
        Matcher cards = Pattern.compile("<z-bookcard\\b([^>]*)>(.*?)</z-bookcard>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(html);
        while (cards.find()) {
            String attrs = cards.group(1);
            String inner = cards.group(2);
            JSONObject item = new JSONObject();
            item.put("sourceId", attr(attrs, "id"));
            item.put("title", slot(inner, "title"));
            JSONArray authors = new JSONArray();
            String author = slot(inner, "author");
            if (!author.isEmpty()) authors.put(author);
            item.put("authors", authors);
            item.put("coverUrl", firstNonEmpty(attr(inner, "data-src"), attr(inner, "src")));
            item.put("year", attr(attrs, "year"));
            item.put("language", attr(attrs, "language"));
            item.put("extension", attr(attrs, "extension").toLowerCase(Locale.ROOT));
            item.put("sizeLabel", attr(attrs, "filesize"));
            item.put("rating", attr(attrs, "rating"));
            item.put("sourceUrl", absoluteUrl(mirror, attr(attrs, "href")));
            item.put("downloadPath", attr(attrs, "download"));
            if (!item.optString("sourceId").isEmpty() && !item.optString("title").isEmpty()) results.put(item);
        }
        return results;
    }

    private List<String> orderedMirrors(String preferred) {
        List<String> mirrors = new ArrayList<>();
        if (preferred != null && !preferred.isEmpty()) mirrors.add(preferred);
        for (String mirror : MIRRORS) {
            if (!mirrors.contains(mirror)) mirrors.add(mirror);
        }
        return mirrors;
    }

    private void appendSearchExtensions(StringBuilder url, String format) throws Exception {
        if (!format.isEmpty()) {
            url.append("&extensions%5B%5D=").append(enc(format.toUpperCase(Locale.ROOT)));
            return;
        }
        url.append("&extensions%5B%5D=EPUB");
        url.append("&extensions%5B%5D=PDF");
        url.append("&extensions%5B%5D=TXT");
    }

    private boolean isBlockedOrInvalidSearch(HttpResult result, String html) {
        String lower = html == null ? "" : html.toLowerCase(Locale.ROOT);
        if (result.status == 401 || result.status == 403 || result.status == 429 || result.status >= 500) return true;
        if (lower.contains("checking your browser") || lower.contains("just a moment") || lower.contains("cf-browser-verification")) return true;
        return lower.contains("<html") && lower.contains("login") && !lower.contains("<z-bookcard");
    }

    private JSObject searchAttempt(String mirror, HttpResult result, String html) {
        JSObject out = new JSObject();
        out.put("mirror", mirror);
        out.put("status", result.status);
        out.put("contentType", result.contentType);
        out.put("contentEncoding", result.header("Content-Encoding"));
        out.put("length", html == null ? 0 : html.length());
        out.put("zBookCards", countMatches(html, "<z-bookcard\\b"));
        out.put("resItemBoxes", countMatches(html, "resItemBox"));
        out.put("title", htmlTitle(html));
        String snippet = html == null ? "" : html.replaceAll("\\s+", " ").trim();
        out.put("snippet", snippet.length() > 160 ? snippet.substring(0, 160) : snippet);
        return out;
    }

    private int countMatches(String text, String regex) {
        if (text == null || text.isEmpty()) return 0;
        Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(text);
        int count = 0;
        while (matcher.find()) count++;
        return count;
    }

    private String htmlTitle(String html) {
        if (html == null) return "";
        Matcher matcher = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(html);
        return matcher.find() ? stripTags(html(matcher.group(1))).trim() : "";
    }

    private HttpResult request(String method, String url, String body, Map<String, String> headers, String cookies) throws Exception {
        return request(method, url, body, headers, cookies, 30000, 60000);
    }

    private HttpResult request(String method, String url, String body, Map<String, String> headers, String cookies, int connectTimeoutMs, int readTimeoutMs) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(connectTimeoutMs);
        conn.setReadTimeout(readTimeoutMs);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) SmartRead/1.0");
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("Accept-Encoding", "identity");
        if (cookies != null && !cookies.isEmpty()) conn.setRequestProperty("Cookie", cookies);
        for (Map.Entry<String, String> entry : headers.entrySet()) conn.setRequestProperty(entry.getKey(), entry.getValue());
        if (body != null) {
            conn.setDoOutput(true);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        in = decodeStream(conn, in);
        byte[] bytes = in == null ? new byte[0] : readStream(in);
        return new HttpResult(status, bytes, conn.getContentType() == null ? "" : conn.getContentType(), conn.getHeaderFields());
    }

    private InputStream decodeStream(HttpURLConnection conn, InputStream in) throws Exception {
        if (in == null) return null;
        String encoding = conn.getContentEncoding();
        if (encoding == null) return in;
        String normalized = encoding.toLowerCase(Locale.ROOT);
        if (normalized.contains("gzip")) return new GZIPInputStream(in);
        if (normalized.contains("deflate")) return new InflaterInputStream(in);
        return in;
    }

    private void runAsync(PluginCall call, ThrowingSupplier<JSObject> task) {
        io.execute(() -> {
            try {
                call.resolve(task.get());
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? String.valueOf(error) : error.getMessage());
            }
        });
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String requireZlibCookies() throws Exception {
        String cookies = prefs().getString(ZLIB_COOKIES, "");
        if (cookies.isEmpty()) throw new Exception("请先绑定 Z-Library 书源");
        return cookies;
    }

    private JSONArray readArray(String key) {
        try {
            return new JSONArray(prefs().getString(key, "[]"));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private void saveArray(String key, JSONArray value) {
        prefs().edit().putString(key, value.toString()).apply();
    }

    private void upsertJob(JSONObject job) throws Exception {
        JSONArray jobs = readArray(JOBS);
        JSONArray next = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject existing = jobs.optJSONObject(i);
            if (existing == null) continue;
            if (existing.optString("id").equals(job.optString("id"))) {
                next.put(job);
                replaced = true;
            } else next.put(existing);
        }
        if (!replaced) next.put(job);
        saveArray(JOBS, next);
    }

    private void updateJob(String jobId, String status, String bookId, String error) {
        try {
            JSONObject job = findById(readArray(JOBS), jobId);
            if (job == null) job = new JSONObject().put("id", jobId);
            job.put("status", status);
            job.put("updatedAt", System.currentTimeMillis());
            if (bookId != null) job.put("bookId", bookId);
            if (error != null) job.put("error", error);
            upsertJob(job);
        } catch (Exception ignored) {}
    }

    private JSONObject findById(JSONArray array, String id) {
        for (int i = 0; i < array.length(); i++) {
            JSONObject obj = array.optJSONObject(i);
            if (obj != null && id.equals(obj.optString("id"))) return obj;
        }
        return null;
    }

    private JSObject toJS(JSONObject obj) {
        try {
            return JSObject.fromJSONObject(obj);
        } catch (Exception error) {
            return new JSObject();
        }
    }

    private JSObject jobPayload(JSONObject job) {
        JSObject normalized = toJS(job);
        String status = job.optString("status", "");
        if ("completed".equals(status)) normalized.put("status", "saved");
        String bookId = job.optString("bookId", "");
        if (!bookId.isEmpty()) {
            JSONObject book = findById(readArray(BOOKS), bookId);
            if (book != null) normalized.put("book", book);
        }
        JSObject out = new JSObject();
        out.put("job", normalized);
        return out;
    }

    private byte[] readFile(File file) throws Exception {
        try (FileInputStream in = new FileInputStream(file)) {
            return readStream(in);
        }
    }

    private byte[] readStream(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toByteArray();
    }

    private String enc(String value) throws Exception {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
    }

    private String attr(String text, String name) {
        Matcher matcher = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*=\\s*['\\\"]([^'\\\"]*)['\\\"]", Pattern.CASE_INSENSITIVE).matcher(text);
        return matcher.find() ? html(matcher.group(1)) : "";
    }

    private String slot(String html, String name) {
        Matcher matcher = Pattern.compile("slot\\s*=\\s*['\\\"]" + Pattern.quote(name) + "['\\\"][^>]*>(.*?)<", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(html);
        return matcher.find() ? html(stripTags(matcher.group(1))).trim() : "";
    }

    private int parseTotalPages(String html) {
        Matcher matcher = Pattern.compile("pagesTotal:\\s*(\\d+)").matcher(html);
        return matcher.find() ? Integer.parseInt(matcher.group(1)) : 0;
    }

    private String absoluteUrl(String mirror, String href) {
        if (href == null || href.isEmpty()) return "";
        if (href.startsWith("http")) return href;
        return mirror + (href.startsWith("/") ? href : "/" + href);
    }

    private String firstNonEmpty(String a, String b) {
        return a == null || a.isEmpty() ? (b == null ? "" : b) : a;
    }

    private String html(String value) {
        return value == null ? "" : value
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
    }

    private String stripTags(String value) {
        return value == null ? "" : value.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ");
    }

    private String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private String maskKey(String key) {
        if (key == null || key.isEmpty()) return "";
        if (key.length() <= 10) return key.substring(0, 2) + "..." + key.substring(Math.max(2, key.length() - 2));
        return key.substring(0, 6) + "..." + key.substring(key.length() - 4);
    }

    private String chatCompletionsUrl(String baseURL) {
        String url = baseURL == null || baseURL.isEmpty() ? DEFAULT_AI_URL : baseURL;
        return url.endsWith("/chat/completions") ? url : url.replaceAll("/+$", "") + "/v1/chat/completions";
    }

    private String sanitizeExt(String ext) {
        String value = ext == null ? "" : ext.toLowerCase(Locale.ROOT);
        return value.equals("pdf") || value.equals("txt") || value.equals("epub") ? value : "epub";
    }

    private String mimeFor(String ext) {
        return switch (sanitizeExt(ext)) {
            case "pdf" -> "application/pdf";
            case "txt" -> "text/plain; charset=utf-8";
            default -> "application/epub+zip";
        };
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    private static class ZlibSession {
        final String mirror;
        final String cookieHeader;
        ZlibSession(String mirror, String cookieHeader) {
            this.mirror = mirror;
            this.cookieHeader = cookieHeader;
        }
    }

    private static class HttpResult {
        final int status;
        final byte[] bytes;
        final String contentType;
        final Map<String, List<String>> headers;
        HttpResult(int status, byte[] bytes, String contentType, Map<String, List<String>> headers) {
            this.status = status;
            this.bytes = bytes;
            this.contentType = contentType;
            this.headers = headers == null ? new HashMap<>() : headers;
        }
        String text() {
            return new String(bytes, StandardCharsets.UTF_8);
        }
        String cookieHeader() {
            List<String> cookies = headers.get("Set-Cookie");
            if (cookies == null) cookies = headers.get("set-cookie");
            if (cookies == null) return "";
            List<String> pairs = new ArrayList<>();
            for (String cookie : cookies) {
                String[] parts = cookie.split(";", 2);
                if (parts.length > 0 && !parts[0].isEmpty()) pairs.add(parts[0]);
            }
            return String.join("; ", pairs);
        }
        String header(String name) {
            List<String> values = headers.get(name);
            if (values == null) values = headers.get(name.toLowerCase(Locale.ROOT));
            if (values == null || values.isEmpty()) return "";
            return values.get(0);
        }
    }
}

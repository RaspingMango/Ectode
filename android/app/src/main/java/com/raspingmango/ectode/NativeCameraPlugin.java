package com.raspingmango.ectode;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Outline;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Size;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.Result;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "NativeCamera",
    permissions = {
        @Permission(
            strings = { Manifest.permission.CAMERA },
            alias = "camera"
        )
    }
)
public class NativeCameraPlugin extends Plugin {

    private static final long ANALYSIS_INTERVAL_MS = 90L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService analysisExecutor;

    private ProcessCameraProvider cameraProvider;
    private Camera activeCamera;
    private FrameLayout backdropContainer;
    private PreviewView previewView;

    private MultiFormatReader zxingReader;
    private byte[] reusableYData;
    private byte[] reusableRotatedYData;
    private byte[] reusableExtraRotatedYData;
    private byte[] reusableRowBuffer;

    private volatile boolean isCameraRunning = false;
    private volatile boolean hasDetected = false;
    private volatile boolean torchEnabled = false;
    private volatile boolean hasTorch = false;
    private volatile int activeSessionToken = 0;
    private volatile long lastAnalysisMs = 0L;
    private volatile int scanAttemptCount = 0;

    private int currentBackdropColor = Color.parseColor("#121316");
    private float currentCornerRadiusPx = 0f;

    @Override
    public void load() {
        super.load();
        analysisExecutor = Executors.newSingleThreadExecutor();
        initZxingReader();
    }

    @Override
    protected void handleOnPause() {
        stopCameraInternal("pause", true);
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        stopCameraInternal("destroy", false);
        if (analysisExecutor != null) {
            analysisExecutor.shutdownNow();
            analysisExecutor = null;
        }
        zxingReader = null;
        reusableYData = null;
        reusableRotatedYData = null;
        reusableExtraRotatedYData = null;
        reusableRowBuffer = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("platform", "android");
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", isCameraRunning);
        result.put("hasTorch", hasTorch);
        result.put("torchEnabled", torchEnabled);
        call.resolve(result);
    }

    @PluginMethod
    public void startCamera(PluginCall call) {
        Context context = getContext();
        Activity activity = getActivity();
        if (context == null || activity == null) {
            call.reject("Activity not available");
            return;
        }

        boolean hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED;

        if (!hasPermission) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }

        launchCamera(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        boolean granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED;

        if (!granted) {
            JSObject denied = new JSObject();
            denied.put("started", false);
            denied.put("permissionDenied", true);
            denied.put("hasTorch", false);
            denied.put("torchEnabled", false);
            call.resolve(denied);
            return;
        }

        launchCamera(call);
    }

    private void launchCamera(PluginCall call) {
        final Activity activity = getActivity();
        final Context context = getContext();
        if (activity == null || context == null || getBridge() == null || getBridge().getWebView() == null) {
            call.reject("Bridge or Activity not available");
            return;
        }

        if (!(activity instanceof LifecycleOwner)) {
            call.reject("Activity is not a LifecycleOwner");
            return;
        }

        final String facing = call.getString("facing", "environment");
        final JSObject bounds = call.getObject("bounds");
        final float viewportWidth = call.getFloat("viewportWidth", 0f);
        final String backdropHex = call.getString("backdropColor", "#121316");
        final int sessionToken = ++activeSessionToken;

        currentBackdropColor = parseColorOrDefault(backdropHex, currentBackdropColor);

        activity.runOnUiThread(() -> {
            if (sessionToken != activeSessionToken) {
                JSObject cancelled = new JSObject();
                cancelled.put("started", false);
                cancelled.put("permissionDenied", false);
                cancelled.put("hasTorch", false);
                cancelled.put("torchEnabled", false);
                call.resolve(cancelled);
                return;
            }

            ensurePreviewOverlay(bounds, viewportWidth, currentBackdropColor);

            final ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(context);
            providerFuture.addListener(() -> {
                if (sessionToken != activeSessionToken) {
                    return;
                }

                try {
                    cameraProvider = providerFuture.get();
                    bindCameraUseCases((LifecycleOwner) activity, facing, call, sessionToken);
                } catch (Exception e) {
                    cleanupViewsOnUiThread();
                    call.reject("Failed to initialize CameraX: " + e.getMessage(), e);
                }
            }, ContextCompat.getMainExecutor(context));
        });
    }

    private void bindCameraUseCases(
        @NonNull LifecycleOwner lifecycleOwner,
        @NonNull String facing,
        @NonNull PluginCall call,
        int sessionToken
    ) {
        if (cameraProvider == null || previewView == null || sessionToken != activeSessionToken) {
            cleanupViewsOnUiThread();
            call.reject("Camera provider or preview is unavailable");
            return;
        }

        try {
            int requestedLens = "user".equalsIgnoreCase(facing)
                ? CameraSelector.LENS_FACING_FRONT
                : CameraSelector.LENS_FACING_BACK;

            CameraSelector selector = new CameraSelector.Builder()
                .requireLensFacing(requestedLens)
                .build();

            if (!cameraProvider.hasCamera(selector)) {
                int fallbackLens = requestedLens == CameraSelector.LENS_FACING_BACK
                    ? CameraSelector.LENS_FACING_FRONT
                    : CameraSelector.LENS_FACING_BACK;
                CameraSelector fallbackSelector = new CameraSelector.Builder()
                    .requireLensFacing(fallbackLens)
                    .build();
                if (!cameraProvider.hasCamera(fallbackSelector)) {
                    cleanupViewsOnUiThread();
                    call.reject("No camera available on this device");
                    return;
                }
                selector = fallbackSelector;
            }

            cameraProvider.unbindAll();

            Preview preview = new Preview.Builder().build();
            preview.setSurfaceProvider(previewView.getSurfaceProvider());

            ResolutionSelector resolutionSelector = new ResolutionSelector.Builder()
                .setResolutionStrategy(
                    new ResolutionStrategy(
                        new Size(1280, 720),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                )
                .build();

            ImageAnalysis imageAnalysis = new ImageAnalysis.Builder()
                .setResolutionSelector(resolutionSelector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build();

            if (analysisExecutor == null || analysisExecutor.isShutdown()) {
                analysisExecutor = Executors.newSingleThreadExecutor();
            }

            hasDetected = false;
            torchEnabled = false;
            lastAnalysisMs = 0L;
            scanAttemptCount = 0;

            imageAnalysis.setAnalyzer(analysisExecutor, this::analyzeImage);

            activeCamera = cameraProvider.bindToLifecycle(
                lifecycleOwner,
                selector,
                preview,
                imageAnalysis
            );

            hasTorch = activeCamera.getCameraInfo().hasFlashUnit();
            isCameraRunning = true;

            JSObject result = new JSObject();
            result.put("started", true);
            result.put("permissionDenied", false);
            result.put("hasTorch", hasTorch);
            result.put("torchEnabled", false);
            call.resolve(result);
        } catch (Exception e) {
            isCameraRunning = false;
            activeCamera = null;
            hasTorch = false;
            torchEnabled = false;
            cleanupViewsOnUiThread();
            call.reject("Failed to bind camera use cases: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateBounds(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }

        final JSObject bounds = call.getObject("bounds");
        final float viewportWidth = call.getFloat("viewportWidth", 0f);
        final String backdropHex = call.getString("backdropColor");
        if (!TextUtils.isEmpty(backdropHex)) {
            currentBackdropColor = parseColorOrDefault(backdropHex, currentBackdropColor);
        }

        activity.runOnUiThread(() -> {
            if (backdropContainer != null) {
                backdropContainer.setBackgroundColor(currentBackdropColor);
            }
            if (previewView != null && bounds != null) {
                applyPreviewBounds(bounds, viewportWidth);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", false);
        final Activity activity = getActivity();
        final Context context = getContext();

        if (activity == null || context == null || activeCamera == null || !isCameraRunning) {
            call.reject("Camera is not active");
            return;
        }

        if (!activeCamera.getCameraInfo().hasFlashUnit()) {
            JSObject result = new JSObject();
            result.put("supported", false);
            result.put("enabled", false);
            call.resolve(result);
            return;
        }

        activity.runOnUiThread(() -> {
            if (activeCamera == null || !isCameraRunning) {
                call.reject("Camera is not active");
                return;
            }
            try {
                ListenableFuture<Void> future = activeCamera.getCameraControl().enableTorch(enabled);
                future.addListener(() -> {
                    try {
                        future.get();
                        torchEnabled = enabled;
                        JSObject result = new JSObject();
                        result.put("supported", true);
                        result.put("enabled", enabled);
                        call.resolve(result);
                    } catch (Exception e) {
                        call.reject("Failed to toggle torch: " + e.getMessage(), e);
                    }
                }, ContextCompat.getMainExecutor(context));
            } catch (Exception e) {
                call.reject("Failed to toggle torch: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void stopCamera(PluginCall call) {
        stopCameraInternal("user", false);
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    private void stopCameraInternal(String reason, boolean notifyListener) {
        activeSessionToken++;
        final boolean wasRunning = isCameraRunning;
        isCameraRunning = false;
        hasDetected = false;
        hasTorch = false;
        torchEnabled = false;

        Runnable cleanupTask = () -> {
            if (activeCamera != null) {
                try {
                    if (activeCamera.getCameraInfo().hasFlashUnit()) {
                        activeCamera.getCameraControl().enableTorch(false);
                    }
                } catch (Exception ignored) {
                }
                activeCamera = null;
            }

            if (cameraProvider != null) {
                try {
                    cameraProvider.unbindAll();
                } catch (Exception ignored) {
                }
            }

            cleanupViewsOnUiThread();

            if (notifyListener && wasRunning) {
                JSObject payload = new JSObject();
                payload.put("running", false);
                payload.put("torchEnabled", false);
                payload.put("reason", reason);
                notifyListeners("cameraState", payload);
            }
        };

        if (Looper.myLooper() == Looper.getMainLooper()) {
            cleanupTask.run();
        } else {
            mainHandler.post(cleanupTask);
        }
    }

    private void ensurePreviewOverlay(JSObject bounds, float viewportWidth, int backdropColor) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View webView = getBridge().getWebView();
        if (!(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) webView.getParent();

        if (backdropContainer == null) {
            backdropContainer = new FrameLayout(webView.getContext());
            backdropContainer.setLayoutParams(
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
        }

        backdropContainer.setBackgroundColor(backdropColor);

        if (previewView == null) {
            previewView = new PreviewView(webView.getContext());
            previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
            previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
            previewView.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), currentCornerRadiusPx);
                }
            });
            previewView.setClipToOutline(true);
        }

        if (previewView.getParent() != backdropContainer) {
            if (previewView.getParent() instanceof ViewGroup) {
                ((ViewGroup) previewView.getParent()).removeView(previewView);
            }
            backdropContainer.addView(previewView);
        }

        if (backdropContainer.getParent() != parent) {
            if (backdropContainer.getParent() instanceof ViewGroup) {
                ((ViewGroup) backdropContainer.getParent()).removeView(backdropContainer);
            }
            parent.addView(backdropContainer, 0);
        }

        if (bounds != null) {
            applyPreviewBounds(bounds, viewportWidth);
        }

        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.bringToFront();
    }

    private void applyPreviewBounds(@NonNull JSObject bounds, float viewportWidth) {
        if (previewView == null || getBridge() == null || getBridge().getWebView() == null) return;
        View webView = getBridge().getWebView();

        float scale = (viewportWidth > 0f && webView.getWidth() > 0)
            ? ((float) webView.getWidth() / viewportWidth)
            : webView.getResources().getDisplayMetrics().density;

        double leftCss = bounds.optDouble("left", 0.0);
        double topCss = bounds.optDouble("top", 0.0);
        double widthCss = bounds.optDouble("width", 0.0);
        double heightCss = bounds.optDouble("height", 0.0);
        double radiusCss = bounds.optDouble("borderRadius", 28.0);

        int pxLeft = webView.getLeft() + (int) Math.round(leftCss * scale);
        int pxTop = webView.getTop() + (int) Math.round(topCss * scale);
        int pxWidth = Math.max(1, (int) Math.round(widthCss * scale));
        int pxHeight = Math.max(1, (int) Math.round(heightCss * scale));
        currentCornerRadiusPx = Math.max(0f, (float) (radiusCss * scale));

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(pxWidth, pxHeight);
        params.leftMargin = pxLeft;
        params.topMargin = pxTop;
        previewView.setLayoutParams(params);
        previewView.invalidateOutline();
    }

    private void cleanupViewsOnUiThread() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(currentBackdropColor);
        }
        if (previewView != null) {
            if (previewView.getParent() instanceof ViewGroup) {
                ((ViewGroup) previewView.getParent()).removeView(previewView);
            }
            previewView = null;
        }
        if (backdropContainer != null && backdropContainer.getParent() instanceof ViewGroup) {
            ((ViewGroup) backdropContainer.getParent()).removeView(backdropContainer);
        }
    }

    private void analyzeImage(@NonNull ImageProxy image) {
        try {
            if (!isCameraRunning || hasDetected || zxingReader == null) {
                return;
            }

            long now = SystemClock.elapsedRealtime();
            if (now - lastAnalysisMs < ANALYSIS_INTERVAL_MS) {
                return;
            }
            lastAnalysisMs = now;

            int width = image.getWidth();
            int height = image.getHeight();
            if (width <= 0 || height <= 0) {
                return;
            }

            ImageProxy.PlaneProxy[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) {
                return;
            }

            ImageProxy.PlaneProxy yPlane = planes[0];
            ByteBuffer yBuffer = yPlane.getBuffer();
            if (yBuffer == null) {
                return;
            }

            int rowStride = yPlane.getRowStride();
            int pixelStride = yPlane.getPixelStride();
            int totalPixels = width * height;
            if (reusableYData == null || reusableYData.length != totalPixels) {
                reusableYData = new byte[totalPixels];
            }

            yBuffer.rewind();
            if (pixelStride == 1 && rowStride == width) {
                int toCopy = Math.min(totalPixels, yBuffer.remaining());
                yBuffer.get(reusableYData, 0, toCopy);
            } else {
                if (reusableRowBuffer == null || reusableRowBuffer.length < rowStride) {
                    reusableRowBuffer = new byte[rowStride];
                }
                int limit = yBuffer.limit();
                for (int y = 0; y < height; y++) {
                    int rowPos = y * rowStride;
                    if (rowPos >= limit) break;
                    int bytesToRead = Math.min(rowStride, limit - rowPos);
                    yBuffer.position(rowPos);
                    yBuffer.get(reusableRowBuffer, 0, bytesToRead);
                    int destRow = y * width;
                    for (int x = 0; x < width; x++) {
                        int srcIndex = x * pixelStride;
                        if (srcIndex >= bytesToRead) break;
                        reusableYData[destRow + x] = reusableRowBuffer[srcIndex];
                    }
                }
            }

            int rotationDegrees = image.getImageInfo().getRotationDegrees();
            byte[] orientedBytes = orientYData(reusableYData, width, height, rotationDegrees);
            int orientedW = (rotationDegrees == 90 || rotationDegrees == 270) ? height : width;
            int orientedH = (rotationDegrees == 90 || rotationDegrees == 270) ? width : height;

            scanAttemptCount++;
            Result decoded = decodeLuminance(orientedBytes, orientedW, orientedH);
            if (decoded == null && (scanAttemptCount % 2 == 0)) {
                byte[] rotated90 = rotateY90Cw(orientedBytes, orientedW, orientedH);
                decoded = decodeLuminance(rotated90, orientedH, orientedW);
            }

            if (decoded != null && !TextUtils.isEmpty(decoded.getText())) {
                hasDetected = true;
                final String text = decoded.getText();
                final String format = decoded.getBarcodeFormat() != null
                    ? decoded.getBarcodeFormat().name()
                    : "QR_CODE";

                mainHandler.post(() -> {
                    stopCameraInternal("detected", false);
                    JSObject payload = new JSObject();
                    payload.put("data", text);
                    payload.put("format", format);
                    payload.put("timestamp", System.currentTimeMillis());
                    notifyListeners("codeDetected", payload);
                });
            }
        } catch (Exception ignored) {
        } finally {
            image.close();
        }
    }

    private Result decodeLuminance(byte[] yData, int width, int height) {
        if (zxingReader == null || yData == null || width <= 0 || height <= 0) return null;
        PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(
            yData,
            width,
            height,
            0,
            0,
            width,
            height,
            false
        );

        Result result = tryDecodeSource(new BinaryBitmap(new HybridBinarizer(source)));
        if (result != null) return result;

        result = tryDecodeSource(new BinaryBitmap(new GlobalHistogramBinarizer(source)));
        if (result != null) return result;

        try {
            return tryDecodeSource(new BinaryBitmap(new HybridBinarizer(source.invert())));
        } catch (Exception ignored) {
            return null;
        }
    }

    private Result tryDecodeSource(BinaryBitmap bitmap) {
        try {
            return zxingReader.decodeWithState(bitmap);
        } catch (ReaderException ignored) {
            return null;
        } finally {
            zxingReader.reset();
        }
    }

    private byte[] orientYData(byte[] src, int width, int height, int degrees) {
        int normalized = ((degrees % 360) + 360) % 360;
        if (normalized == 0) {
            return src;
        }

        int total = width * height;
        if (reusableRotatedYData == null || reusableRotatedYData.length != total) {
            reusableRotatedYData = new byte[total];
        }

        if (normalized == 90) {
            for (int y = 0; y < height; y++) {
                int rowOffset = y * width;
                int destCol = height - 1 - y;
                for (int x = 0; x < width; x++) {
                    reusableRotatedYData[x * height + destCol] = src[rowOffset + x];
                }
            }
        } else if (normalized == 180) {
            for (int y = 0; y < height; y++) {
                int rowOffset = y * width;
                int destRow = (height - 1 - y) * width;
                for (int x = 0; x < width; x++) {
                    reusableRotatedYData[destRow + (width - 1 - x)] = src[rowOffset + x];
                }
            }
        } else {
            // 270 degrees
            for (int y = 0; y < height; y++) {
                int rowOffset = y * width;
                for (int x = 0; x < width; x++) {
                    reusableRotatedYData[(width - 1 - x) * height + y] = src[rowOffset + x];
                }
            }
        }

        return reusableRotatedYData;
    }

    private byte[] rotateY90Cw(byte[] src, int width, int height) {
        int total = width * height;
        if (reusableExtraRotatedYData == null || reusableExtraRotatedYData.length != total) {
            reusableExtraRotatedYData = new byte[total];
        }
        for (int y = 0; y < height; y++) {
            int rowOffset = y * width;
            int destCol = height - 1 - y;
            for (int x = 0; x < width; x++) {
                reusableExtraRotatedYData[x * height + destCol] = src[rowOffset + x];
            }
        }
        return reusableExtraRotatedYData;
    }

    private void initZxingReader() {
        MultiFormatReader reader = new MultiFormatReader();
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        List<BarcodeFormat> formats = Arrays.asList(
            BarcodeFormat.QR_CODE,
            BarcodeFormat.CODE_128,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_39,
            BarcodeFormat.ITF,
            BarcodeFormat.CODABAR,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.AZTEC
        );
        hints.put(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        reader.setHints(hints);
        zxingReader = reader;
    }

    private static int parseColorOrDefault(String hexColor, int fallback) {
        if (TextUtils.isEmpty(hexColor)) return fallback;
        try {
            return Color.parseColor(hexColor.trim());
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }
}

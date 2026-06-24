"use client";

import { Camera, Gauge, PlugZap, RefreshCcw, ScanEye } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListboxSelect } from "@/components/ui/listbox-select";
import {
  CameraImageViewer,
  type CameraLiveStats,
  type CameraViewTransform,
} from "@/components/camera/camera-image-viewer";
import { CameraSettingsForm } from "@/components/camera/camera-settings-form";
import {
  formatCameraApiError,
  formatCameraErrorMessage,
} from "@/components/camera/camera-error";
import {
  connectCamera,
  getCameraFrameRate,
  getCameraStatus,
  getCameraStreamUrl,
  DEFAULT_CAMERA_STREAM_JPEG_QUALITY,
  DEFAULT_CAMERA_STREAM_MAX_WIDTH,
  grabCameraFrame,
  listCameraDevices,
  listProductProfiles,
  updateProductProfile,
  type CameraDevice,
  type CameraFrame,
  type CameraFrameRate,
  type CameraProfile,
  type CameraRuntimeStatus,
  type ProductProfile,
  type ProductProfilePayload,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getAccessToken } from "@/lib/session";

export function CameraLiveViewPanel() {
  const { apiError, t } = useI18n();
  const [products, setProducts] = useState<ProductProfile[]>([]);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [status, setStatus] = useState<CameraRuntimeStatus | null>(null);
  const [frameRate, setFrameRate] = useState<CameraFrameRate | null>(null);
  const [frame, setFrame] = useState<CameraFrame | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [live, setLive] = useState(false);
  const [streamFrameUrl, setStreamFrameUrl] = useState("");
  const [liveStats, setLiveStats] = useState<CameraLiveStats | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewerTransform, setViewerTransform] = useState<CameraViewTransform>({
    zoomFactor: 1,
    previewPanX: 0,
    previewPanY: 0,
    previewRotation: 0,
  });
  const streamSocketRef = useRef<WebSocket | null>(null);
  const streamFrameUrlRef = useRef("");
  const streamMetaRef = useRef<StreamFrameMeta | null>(null);
  const streamFrameTimesRef = useRef<number[]>([]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  useEffect(() => {
    let cancelled = false;

    async function loadCameraContext() {
      const accessToken = getAccessToken();

      if (!accessToken) {
        toast.error(t("users.missingSession"));
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const [productResponse, cameraRuntime] = await Promise.all([
          listProductProfiles(accessToken),
          loadCameraRuntime(accessToken),
        ]);

        if (cancelled) {
          return;
        }

        const activeProducts = productResponse.data.filter(
          (product) => product.active,
        );
        setProducts(activeProducts);
        setSelectedProductId(activeProducts[0]?.id ?? "");
        setStatus(cameraRuntime.statusResponse);
        setDevices(cameraRuntime.devices);
        setFrameRate(cameraRuntime.frameRateResponse);
      } catch (cause) {
        if (!cancelled) {
          toast.error(formatCameraApiError(cause, apiError, t, "camera.loadError"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCameraContext();

    return () => {
      cancelled = true;
    };
  }, [apiError, t]);

  async function refreshCameraRuntime() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      toast.error(t("users.missingSession"));
      return;
    }

    setRefreshingDevices(true);
    const toastId = toast.loading(t("camera.refreshingDevices"));

    try {
      const cameraRuntime = await loadCameraRuntime(accessToken);
      setStatus(cameraRuntime.statusResponse);
      setDevices(cameraRuntime.devices);
      setFrameRate(cameraRuntime.frameRateResponse);
      toast.success(t("camera.devicesRefreshed"), { id: toastId });
    } catch (cause) {
      toast.error(
        formatCameraApiError(cause, apiError, t, "camera.devicesRefreshError"),
        { id: toastId },
      );
    } finally {
      setRefreshingDevices(false);
    }
  }

  useEffect(() => {
    return () => {
      streamSocketRef.current?.close();

      if (streamFrameUrlRef.current) {
        URL.revokeObjectURL(streamFrameUrlRef.current);
      }
    };
  }, []);

  async function handleConnectCamera() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      toast.error(t("users.missingSession"));
      return;
    }

    if (!selectedProduct) {
      toast.warning(t("camera.selectProductFirst"));
      return;
    }

    setConnecting(true);
    const toastId = toast.loading(t("camera.connecting"));

    try {
      const response = await connectCamera(accessToken, selectedProduct.camera);
      setStatus(response);
      toast.success(t("camera.connected"), { id: toastId });
    } catch (cause) {
      toast.error(formatCameraApiError(cause, apiError, t, "camera.connectError"), {
        id: toastId,
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleGrabFrame(showToast = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      toast.error(t("users.missingSession"));
      setLive(false);
      return;
    }

    setGrabbing(true);

    try {
      const response = await grabCameraFrame(accessToken);
      setFrame(response);

      if (showToast) {
        toast.success(t("camera.grabbed"));
      }
    } catch (cause) {
      setLive(false);

      if (showToast) {
        toast.error(formatCameraApiError(cause, apiError, t, "camera.grabError"));
      }
    } finally {
      setGrabbing(false);
    }
  }

  async function handleToggleLiveStream() {
    if (live) {
      closeLiveStream();
      toast.success(t("camera.streamStopped"));
      return;
    }

    await startLiveStream();
  }

  async function startLiveStream() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      toast.error(t("users.missingSession"));
      return;
    }

    if (!selectedProduct) {
      toast.warning(t("camera.selectProductFirst"));
      return;
    }

    setConnecting(true);
    const toastId = toast.loading(t("camera.connecting"));

    try {
      const response = await connectCamera(accessToken, selectedProduct.camera);
      const nextFrameRate = await getCameraFrameRate(accessToken);
      setStatus(response);
      setFrameRate(nextFrameRate);
      openStreamSocket(accessToken, toastId);
    } catch (cause) {
      setLive(false);
      toast.error(formatCameraApiError(cause, apiError, t, "camera.connectError"), {
        id: toastId,
      });
    } finally {
      setConnecting(false);
    }
  }

  function openStreamSocket(
    accessToken: string,
    toastId: string | number,
  ) {
    closeLiveStream({ silent: true });

    const socket = new WebSocket(
      getCameraStreamUrl(accessToken, {
        jpegQuality: DEFAULT_CAMERA_STREAM_JPEG_QUALITY,
        maxWidth: DEFAULT_CAMERA_STREAM_MAX_WIDTH,
      }),
    );
    socket.binaryType = "blob";
    streamSocketRef.current = socket;

    socket.onopen = () => {
      resetLiveStats();
      setLive(true);
      toast.success(t("camera.streamStarted"), { id: toastId });
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleStreamMessage(event.data);
        return;
      }

      updateLiveStats();
      replaceStreamFrameUrl(URL.createObjectURL(event.data as Blob));
    };

    socket.onerror = () => {
      toast.error(t("camera.streamError"), { id: toastId });
    };

    socket.onclose = () => {
      if (streamSocketRef.current === socket) {
        streamSocketRef.current = null;
      }

      setLive(false);
    };
  }

  function handleStreamMessage(message: string) {
    try {
      const payload = JSON.parse(message) as StreamMessage;

      if ("type" in payload && payload.type === "frame_meta") {
        streamMetaRef.current = payload;
        return;
      }

      if ("error" in payload && payload.error) {
        toast.error(
          formatCameraErrorMessage(payload.error, apiError, t, "camera.streamError"),
        );
      }
    } catch {
      toast.error(t("camera.streamError"));
    }
  }

  function updateLiveStats() {
    const now = Date.now();
    const frameTimes = streamFrameTimesRef.current
      .filter((timestamp) => now - timestamp <= 1000)
      .concat(now);
    const meta = streamMetaRef.current;

    streamFrameTimesRef.current = frameTimes;
    setLiveStats({
      fps: frameTimes.length,
      cameraFps: meta?.camera_resulting_fps ?? meta?.stream_fps ?? null,
      cameraMaxFps: meta?.camera_max_fps ?? null,
      delayMs: meta?.sent_at_ms ? now - meta.sent_at_ms : null,
      captureTimeMs: meta?.capture_time_ms ?? null,
    });
  }

  function resetLiveStats() {
    streamMetaRef.current = null;
    streamFrameTimesRef.current = [];
    setLiveStats(null);
  }

  function closeLiveStream(options: { silent?: boolean } = {}) {
    const socket = streamSocketRef.current;

    if (socket) {
      streamSocketRef.current = null;
      socket.close();
    }

    replaceStreamFrameUrl("");
    resetLiveStats();
    setLive(false);

    if (!options.silent) {
      setStatus((current) =>
        current
          ? {
              ...current,
              data: {
                ...current.data,
                is_grabbing: false,
              },
            }
          : current,
      );
    }
  }

  function replaceStreamFrameUrl(nextFrameUrl: string) {
    if (streamFrameUrlRef.current) {
      URL.revokeObjectURL(streamFrameUrlRef.current);
    }

    streamFrameUrlRef.current = nextFrameUrl;
    setStreamFrameUrl(nextFrameUrl);
  }

  function handleSavedProduct(product: ProductProfile) {
    setProducts((current) =>
      current.map((item) => (item.id === product.id ? product : item)),
    );
    setViewerTransform(toViewerTransform(product.camera));
  }

  async function handleSaveView() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      toast.error(t("users.missingSession"));
      return;
    }

    if (!selectedProduct) {
      toast.warning(t("camera.selectProductFirst"));
      return;
    }

    if (!imageSource) {
      toast.warning(t("camera.noFrame"));
      return;
    }

    setSavingView(true);
    const toastId = toast.loading(t("camera.savingSettings"));

    try {
      const response = await updateProductProfile(
        accessToken,
        selectedProduct.id,
        buildProductPayload(selectedProduct, {
          ...selectedProduct.camera,
          zoomFactor: viewerTransform.zoomFactor,
          previewPanX: viewerTransform.previewPanX,
          previewPanY: viewerTransform.previewPanY,
          previewRotation: normalizeRotation(viewerTransform.previewRotation),
        }),
      );
      handleSavedProduct(response.data);
      toast.success(t("camera.settingsSaved"), { id: toastId });
    } catch (cause) {
      toast.error(formatCameraApiError(cause, apiError, t, "camera.settingsSaveError"), {
        id: toastId,
      });
    } finally {
      setSavingView(false);
    }
  }

  const connected = Boolean(status?.data?.connected);
  const imageSource = streamFrameUrl
    ? streamFrameUrl
    : frame
      ? `data:${mediaTypeForFrame(frame.encode_format)};base64,${frame.image_base64}`
      : "";

  return (
    <div className="grid min-h-0 gap-5">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ScanEye className="h-5 w-5 text-cyan-700" />
              {t("camera.liveView")}
            </CardTitle>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge
                className={
                  connected
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }
              >
                {connected ? t("camera.connected") : t("camera.disconnected")}
              </Badge>
              {live ? (
                <Badge className="border-cyan-200 bg-cyan-50 text-cyan-800">
                  {t("camera.live")}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleGrabFrame()}
              disabled={loading || grabbing || live}
            >
              <RefreshCcw className="h-4 w-4" />
              {grabbing ? t("camera.grabbing") : t("camera.grab")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleToggleLiveStream()}
              disabled={loading || connecting}
            >
              <Camera className="h-4 w-4" />
              {live ? t("camera.stopLive") : t("camera.startLive")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <CameraImageViewer
            key={buildViewerKey(selectedProduct)}
            imageSource={imageSource}
            frame={frame}
            live={live}
            liveStats={liveStats}
            baseZoom={selectedProduct?.camera.zoomFactor ?? 1}
            initialPreviewPanX={selectedProduct?.camera.previewPanX ?? 0}
            initialPreviewPanY={selectedProduct?.camera.previewPanY ?? 0}
            initialRotation={selectedProduct?.camera.previewRotation ?? 0}
            onTransformChange={setViewerTransform}
            footerAction={
              <Button
                type="button"
                onClick={() => void handleSaveView()}
                disabled={!selectedProduct || !imageSource || savingView}
                className="h-10 border-cyan-700 bg-cyan-700 px-4 text-white hover:bg-cyan-800"
              >
                {savingView
                  ? t("camera.savingSettings")
                  : t("camera.saveSettings")}
              </Button>
            }
            title={t("camera.liveView")}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-5">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="text-lg">{t("camera.setup")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <PanelSection
              title={t("camera.productProfile")}
              description={selectedProduct?.name ?? t("camera.selectProductFirst")}
            >
              <label className="block space-y-2">
                <ListboxSelect
                  value={selectedProductId}
                  onChange={setSelectedProductId}
                  disabled={loading || products.length === 0}
                  emptyLabel={t("products.emptyTitle")}
                  options={products.map((product) => ({
                    value: product.id,
                    label: `${product.code} - ${product.camera.deviceName || product.camera.sourceType}`,
                    description: product.name || undefined,
                  }))}
                />
              </label>

              <Button
                type="button"
                className="mt-3 w-full"
                onClick={() => void handleConnectCamera()}
                disabled={loading || connecting || live || !selectedProduct}
              >
                <PlugZap className="h-4 w-4" />
                {connecting ? t("camera.connecting") : t("camera.connect")}
              </Button>
            </PanelSection>

            <PanelSection
              title={t("camera.frameRate")}
              headerAction={
                <Badge className="border-cyan-200 bg-cyan-50 text-cyan-700">
                  {t("camera.frameRateNoAppLimit")}
                </Badge>
              }
            >
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <FrameRateMetric
                  label={t("camera.frameRateActual")}
                  value={formatFps(frameRate?.data.camera_resulting_fps)}
                />
                <FrameRateMetric
                  label={t("camera.frameRateMax")}
                  value={
                    frameRate?.data.camera_max_fps
                      ? formatFps(frameRate.data.camera_max_fps)
                      : t("camera.frameRateCameraLimit")
                  }
                />
                <FrameRateMetric
                  label={t("camera.frameRateStreamMode")}
                  value={t("camera.frameRateFastest")}
                />
              </div>
              <div className="mt-3 text-xs leading-5 text-slate-500">
                {t("camera.frameRateFastestHint")}
              </div>
            </PanelSection>

            <PanelSection
              title={t("camera.devices")}
              headerAction={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshCameraRuntime()}
                  disabled={refreshingDevices || connecting || live}
                  className="h-9 px-3"
                >
                  <RefreshCcw
                    className={[
                      "h-4 w-4",
                      refreshingDevices ? "animate-spin" : "",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  {refreshingDevices
                    ? t("camera.refreshingDevices")
                    : t("camera.refreshDevices")}
                </Button>
              }
            >
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-slate-600">
                {devices.length > 0 ? (
                  devices.map((device) => (
                    <button
                      key={`${device.index}-${device.serial_number ?? device.friendly_name}`}
                      type="button"
                      onClick={() => {
                        if (!selectedProduct) {
                          return;
                        }

                        handleSavedProduct({
                          ...selectedProduct,
                          camera: {
                            ...selectedProduct.camera,
                            sourceType: "usb",
                            deviceName: device.friendly_name,
                          },
                        });
                      }}
                      className="block w-full border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50"
                    >
                      <div className="font-medium text-slate-900">
                        #{device.index} {device.friendly_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {device.model_name ?? "-"} - {device.serial_number ?? "-"}
                      </div>
                    </button>
                  ))
                ) : (
                  <div>{t("camera.noDevices")}</div>
                )}
              </div>
            </PanelSection>
          </CardContent>
        </Card>

        <CameraSettingsForm
          key={buildSettingsFormKey(selectedProduct)}
          product={selectedProduct}
          devices={devices}
          disabled={loading || live}
          onSaved={handleSavedProduct}
        />
      </div>
    </div>
  );
}

type StreamFrameMeta = {
  type: "frame_meta";
  capture_time_ms?: number | null;
  sent_at_ms?: number | null;
  stream_fps?: number | null;
  camera_resulting_fps?: number | null;
  camera_max_fps?: number | null;
};

type StreamMessage = StreamFrameMeta | { error?: string };

async function loadCameraRuntime(accessToken: string) {
  const [statusResponse, deviceResponse, frameRateResult] = await Promise.all([
    getCameraStatus(accessToken),
    listCameraDevices(accessToken),
    getCameraFrameRate(accessToken).catch(() => defaultCameraFrameRate()),
  ]);

  return {
    statusResponse,
    devices: deviceResponse.data,
    frameRateResponse: frameRateResult,
  };
}

function FrameRateMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="border border-slate-200 bg-white px-2 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function PanelSection({
  title,
  description,
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Gauge className="h-4 w-4 text-cyan-700" aria-hidden="true" />
            <span>{title}</span>
          </div>
          {description ? (
            <div className="mt-1 text-xs leading-5 text-slate-500">
              {description}
            </div>
          ) : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function defaultCameraFrameRate(): CameraFrameRate {
  return {
    success: true,
    data: {
      connected: false,
      requested_stream_fps: null,
      configured_fps: null,
      camera_resulting_fps: null,
      camera_max_fps: null,
      effective_stream_fps: null,
      writable: false,
      error: null,
      source: null,
    },
  };
}

function formatFps(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} FPS`;
}

function mediaTypeForFrame(format: string) {
  if (format === ".png") {
    return "image/png";
  }

  if (format === ".bmp") {
    return "image/bmp";
  }

  return "image/jpeg";
}

function buildViewerKey(product: ProductProfile | null) {
  if (!product) {
    return "camera-viewer-empty";
  }

  return [
    product.id,
    product.updatedAt,
    product.camera.zoomFactor,
    product.camera.previewPanX,
    product.camera.previewPanY,
    product.camera.previewRotation,
  ].join("-");
}

function buildSettingsFormKey(product: ProductProfile | null) {
  if (!product) {
    return "camera-settings-empty";
  }

  return [
    product.id,
    product.updatedAt,
    product.camera.sourceType,
    product.camera.deviceName,
    product.camera.rtspUrl,
  ].join("-");
}

function toViewerTransform(camera: CameraProfile): CameraViewTransform {
  return {
    zoomFactor: camera.zoomFactor ?? 1,
    previewPanX: camera.previewPanX ?? 0,
    previewPanY: camera.previewPanY ?? 0,
    previewRotation: camera.previewRotation ?? 0,
  };
}

function normalizeRotation(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function buildProductPayload(
  product: ProductProfile,
  camera: CameraProfile,
): ProductProfilePayload {
  return {
    code: product.code,
    name: product.name,
    defaultNumber: product.defaultNumber,
    batchSize: product.batchSize,
    exposure: product.exposure,
    thresholdAccept: product.thresholdAccept,
    thresholdMns: product.thresholdMns,
    modelPath: product.modelPath ?? undefined,
    active: product.active,
    camera: {
      ...camera,
      deviceName: camera.deviceName?.trim() || undefined,
      rtspUrl: camera.rtspUrl?.trim() || undefined,
    },
    roiRegions: product.roiRegions,
  };
}

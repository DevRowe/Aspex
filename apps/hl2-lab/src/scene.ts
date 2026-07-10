import type { AttentionItem } from "@aspex/schema";
import * as THREE from "three";
import type { ArmedAction } from "./confirmation";
import type { ConnectionState } from "./domain";
import type { FocusController } from "./input";
import type { VoiceState } from "./voice";

export interface SceneView {
  item?: AttentionItem;
  index: number;
  total: number;
  overflow: number;
  connection: ConnectionState;
  voice: VoiceState;
  armed: ArmedAction<unknown> | null;
  retryAvailable: boolean;
  notice: string;
}

const CARD_WIDTH = 1.18;
const CARD_HEIGHT = 0.62;
const PANEL_Z = -2;

export class LabScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.01, 20);
  private readonly root = new THREE.Group();
  private readonly targetMeshes: THREE.Mesh[] = [];
  private readonly controllers: THREE.Group[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly reticle: THREE.Mesh;
  private focusedId: string | null = null;
  private session: XRSession | null = null;
  private view: SceneView | null = null;

  constructor(
    container: HTMLElement,
    private input: FocusController,
    private onSessionChange: (active: boolean) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x090b0b, 0);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    this.renderer.domElement.id = "spatial-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive spatial glance card scene",
    );
    container.prepend(this.renderer.domElement);

    this.root.position.set(0, 0.02, 0);
    this.scene.add(this.root);
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.022, 32),
      new THREE.MeshBasicMaterial({
        color: 0xeaf4df,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    this.reticle.position.set(0, 0, PANEL_Z + 0.02);
    this.scene.add(this.reticle);

    for (let index = 0; index < 4; index += 1) {
      const controller = this.renderer.xr.getController(index);
      controller.addEventListener("selectstart", () =>
        this.input.selectStart(),
      );
      controller.addEventListener("select", () => this.input.select());
      controller.addEventListener("selectend", () => this.input.selectEnd());
      this.controllers.push(controller);
      this.scene.add(controller);
    }

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", (event) =>
      this.updatePointer(event),
    );
    canvas.addEventListener("pointerdown", (event) => {
      this.updatePointer(event);
      this.input.selectStart();
    });
    canvas.addEventListener("pointerup", () => {
      this.input.select();
      this.input.selectEnd();
    });
    canvas.addEventListener("pointerleave", () => {
      this.input.focus(null);
      this.input.cancelHold();
    });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.renderFrame());
  }

  setView(view: SceneView): void {
    this.view = view;
    this.rebuild();
  }

  setFocus(targetId: string | null): void {
    this.focusedId = targetId;
    for (const mesh of this.targetMeshes) {
      const material = mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        const base = mesh.userData.baseColor as number | undefined;
        material.color.setHex(
          targetId === mesh.userData.targetId ? 0xd7ef69 : (base ?? 0x28302d),
        );
      }
    }
    this.reticle.scale.setScalar(targetId === null ? 0.72 : 1);
  }

  async supportsAr(): Promise<boolean> {
    return navigator.xr?.isSessionSupported
      ? navigator.xr.isSessionSupported("immersive-ar")
      : false;
  }

  async enterAr(): Promise<void> {
    if (this.session !== null || navigator.xr === undefined) {
      return;
    }
    const session = await navigator.xr.requestSession("immersive-ar", {
      optionalFeatures: [
        "local-floor",
        "bounded-floor",
        "hand-tracking",
        "dom-overlay",
      ],
      domOverlay: { root: document.getElementById("app") ?? document.body },
    });
    this.session = session;
    session.addEventListener("end", () => {
      this.session = null;
      this.input.cancelHold();
      this.resize();
      this.onSessionChange(false);
    });
    await this.renderer.xr.setSession(session);
    this.root.scale.set(1, 1, 1);
    this.onSessionChange(true);
  }

  async exitAr(): Promise<void> {
    await this.session?.end();
  }

  private rebuild(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      disposeObject(child);
    }
    this.targetMeshes.length = 0;
    const view = this.view;
    if (view === null) {
      return;
    }

    const card = this.cardMesh(view);
    card.position.set(0, 0.08, PANEL_Z);
    this.root.add(card);

    const actions =
      view.armed !== null
        ? [
            { id: "confirm:yes", label: "CONFIRM", color: 0xb8d54a },
            { id: "confirm:cancel", label: "CANCEL", color: 0x3d4642 },
          ]
        : view.voice.phase === "armed"
          ? [
              {
                id: "control:voice-cancel",
                label: "CANCEL VOICE ARM",
                color: 0x3d4642,
              },
            ]
          : (view.item?.actions.slice(0, 4).map((action) => ({
              id: `action:${action.id}`,
              label:
                action.id === "ship"
                  ? "REVIEW + SHIP"
                  : action.label.toUpperCase(),
              color:
                action.risk === "dangerous"
                  ? 0xb85a43
                  : action.risk === "medium"
                    ? 0x8a753b
                    : 0x344d3b,
            })) ?? []);

    const actionWidth = Math.min(
      0.28,
      (CARD_WIDTH - 0.03 * Math.max(0, actions.length - 1)) /
        Math.max(actions.length, 1),
    );
    actions.forEach((action, index) => {
      const x = (index - (actions.length - 1) / 2) * (actionWidth + 0.03);
      this.root.add(
        this.button(
          action.id,
          action.label,
          actionWidth,
          0.1,
          action.color,
          x,
          -0.31,
        ),
      );
    });

    this.root.add(
      this.button("nav:previous", "<", 0.12, 0.1, 0x28302d, -0.52, -0.45),
    );
    this.root.add(
      this.button(
        view.retryAvailable ? "control:retry" : "control:status",
        view.retryAvailable ? "RETRY" : "STATUS",
        0.2,
        0.1,
        view.retryAvailable ? 0x8a753b : 0x28302d,
        -0.32,
        -0.45,
      ),
    );
    this.root.add(
      this.button(
        "control:ptt",
        view.voice.phase === "recording" ? "LISTENING" : "HOLD TO TALK",
        0.34,
        0.1,
        view.voice.phase === "recording" ? 0xb85a43 : 0x48634c,
        0,
        -0.45,
      ),
    );
    this.root.add(
      this.button("control:settings", "SET", 0.12, 0.1, 0x28302d, 0.32, -0.45),
    );
    this.root.add(
      this.button("nav:next", ">", 0.12, 0.1, 0x28302d, 0.52, -0.45),
    );
    this.setFocus(this.focusedId);
  }

  private cardMesh(view: SceneView): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1180;
    canvas.height = 620;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is unavailable");
    }
    const item = view.item;
    context.fillStyle = "#111714";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = severityColor(item?.severity);
    context.lineWidth = 12;
    context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

    context.fillStyle = "#8fa096";
    context.font = "600 34px system-ui, sans-serif";
    context.fillText(item?.project.toUpperCase() ?? "ASPEX HL2 LAB", 50, 60);
    context.textAlign = "right";
    context.fillText(
      view.total === 0
        ? "0 ITEMS"
        : `${view.index + 1} / ${view.total}${view.overflow > 0 ? `  +${view.overflow}` : ""}`,
      1130,
      60,
    );
    context.textAlign = "left";

    context.fillStyle = "#eef3eb";
    context.font = "700 54px system-ui, sans-serif";
    const summary = item?.summary ?? connectionHeadline(view.connection);
    drawWrapped(context, summary, 50, 130, 1080, 67, 3);

    context.font = "600 30px system-ui, sans-serif";
    context.fillStyle = severityColor(item?.severity);
    const stateLine =
      item === undefined
        ? `${view.connection.phase.replaceAll("_", " ")} · ${view.connection.detail}`
        : `${item.state.replaceAll("_", " ")} · ${item.reason.replaceAll("_", " ")} · ${item.liveness}`;
    context.fillText(fitText(context, stateLine.toUpperCase(), 1080), 50, 354);

    context.font = "400 31px system-ui, sans-serif";
    context.fillStyle = "#b9c3bc";
    const evidence = item?.evidence.slice(0, 2) ?? [];
    evidence.forEach((entry, index) => {
      const detail = entry.text ?? entry.url ?? "";
      context.fillText(
        fitText(context, `${entry.label}: ${detail}`, 1080),
        50,
        415 + index * 48,
      );
    });

    const footer =
      view.armed !== null
        ? `ARMED: ${view.armed.label} · explicit second confirm required`
        : view.notice || view.voice.message;
    context.font = "600 27px system-ui, sans-serif";
    context.fillStyle = view.armed !== null ? "#f3df7f" : "#8fa096";
    context.fillText(fitText(context, footer, 1080), 50, 570);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
    });
    return new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT),
      material,
    );
  }

  private button(
    id: string,
    label: string,
    width: number,
    height: number,
    color: number,
    x: number,
    y: number,
  ): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(256, Math.round(width * 1200));
    canvas.height = 144;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is unavailable");
    }
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#647169";
    context.lineWidth = 6;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = "#f1f4ed";
    context.font = "700 38px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      fitText(context, label, canvas.width - 24),
      canvas.width / 2,
      canvas.height / 2 + 2,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      material,
    );
    mesh.position.set(x, y, PANEL_Z + 0.012);
    mesh.userData.targetId = id;
    mesh.userData.baseColor = 0xffffff;
    this.targetMeshes.push(mesh);
    return mesh;
  }

  private updatePointer(event: PointerEvent): void {
    if (this.renderer.xr.isPresenting) {
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.applyRaycast();
  }

  private renderFrame(): void {
    if (this.renderer.xr.isPresenting) {
      let hit = false;
      for (const controller of this.controllers) {
        if (!controller.visible) {
          continue;
        }
        controller.updateMatrixWorld(true);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction
          .set(0, 0, -1)
          .transformDirection(controller.matrixWorld);
        hit = this.applyRaycast() || hit;
      }
      if (!hit) {
        this.input.focus(null);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private applyRaycast(): boolean {
    const intersection = this.raycaster.intersectObjects(
      this.targetMeshes,
      false,
    )[0];
    if (intersection === undefined) {
      this.input.focus(null);
      this.reticle.position.set(0, 0, PANEL_Z + 0.02);
      return false;
    }
    this.input.focus(intersection.object.userData.targetId as string);
    this.reticle.position.copy(intersection.point);
    this.reticle.position.z += 0.018;
    return true;
  }

  private resize(): void {
    const width =
      this.renderer.domElement.parentElement?.clientWidth ?? window.innerWidth;
    const height =
      this.renderer.domElement.parentElement?.clientHeight ??
      window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    if (!this.renderer.xr.isPresenting) {
      const visibleWidth =
        2 *
        Math.abs(PANEL_Z) *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
        this.camera.aspect;
      const fit = Math.min(1, (visibleWidth * 0.9) / CARD_WIDTH);
      this.root.scale.set(fit, fit, 1);
    }
    this.renderer.setSize(width, height, false);
  }
}

function drawWrapped(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line || word);
      line = line === "" ? "" : word;
      if (lines.length === maxLines) {
        break;
      }
    }
  }
  if (lines.length < maxLines && line !== "") {
    lines.push(line);
  }
  lines.slice(0, maxLines).forEach((value, index) => {
    const last = index === maxLines - 1 && words.join(" ") !== lines.join(" ");
    context.fillText(
      fitText(context, last ? `${value}…` : value, maxWidth),
      x,
      y + index * lineHeight,
    );
  });
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string {
  if (context.measureText(text).width <= width) {
    return text;
  }
  let value = text;
  while (value.length > 1 && context.measureText(`${value}…`).width > width) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function severityColor(
  severity: AttentionItem["severity"] | undefined,
): string {
  switch (severity) {
    case "high":
      return "#e47a5f";
    case "medium":
      return "#e1c463";
    case "low":
      return "#a8be79";
    default:
      return "#7faaa0";
  }
}

function connectionHeadline(connection: ConnectionState): string {
  switch (connection.phase) {
    case "unconfigured":
      return "Pair this lab client with your Aspex Hub.";
    case "auth_failed":
      return "Authentication failed. Check the pairing token.";
    case "offline":
      return "Offline. Last known cards stay visible while the client retries.";
    case "malformed":
      return "The Hub sent malformed state. Previous cards were preserved.";
    default:
      return "Waiting for the real Hub world-model.";
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) {
        material.map?.dispose();
      }
      material.dispose();
    }
  });
}

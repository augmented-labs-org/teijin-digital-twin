import {
    ArcRotateCamera,
    BaseCameraPointersInput,
    Matrix,
    Plane,
    Vector3,
    type IPointerEvent,
    type Nullable,
    type PointerTouch,
} from "@babylonjs/core";

/**
 * Two-finger gesture that has taken ownership of the current interaction.
 * `none` means no gesture has crossed its activation threshold yet.
 */
type TwoFingerMode = "none" | "pan" | "zoom" | "twist" | "tilt";

/** Activation thresholds, measured from the start of the two-finger gesture. */
const PAN_ACTIVATE_PX = 8;
const TILT_ACTIVATE_PX = 8;
const PINCH_ACTIVATE_PX = 6;
const TWIST_ACTIVATE_RAD = 0.06; // ~3.5 degrees

/**
 * Google-Maps style pointer controls for {@link MapCamera}.
 *
 * Desktop:
 *  - left drag                 -> pan (the grabbed point stays under the cursor)
 *  - shift + left drag         -> rotate (orbit)
 *
 * Mobile:
 *  - one finger drag           -> pan
 *  - two finger drag           -> pan (activated by horizontal travel, then free)
 *  - two finger twist          -> rotate (orbit around the target)
 *  - two finger vertical swipe  -> tilt (change beta)
 *  - two finger pinch          -> zoom
 *
 * Single-finger panning ray-casts the pointer onto a horizontal plane at the
 * grabbed point's height and translates the camera target so that world point
 * tracks the pointer, regardless of the current zoom level.
 *
 * The four two-finger gestures are arbitrated: the first one to cross its
 * activation threshold locks the interaction into a mode that decides which
 * gestures may run for the rest of the touch:
 *  - pan first   -> pan + zoom + twist + tilt (everything)
 *  - twist first -> pan + zoom + twist (no tilt)
 *  - zoom first  -> pan + zoom (no twist, no tilt)
 *  - tilt first  -> tilt only
 */
export class MapCameraPointersInput extends BaseCameraPointersInput {
    // Attached by the input manager; always an ArcRotateCamera-derived MapCamera.
    override camera!: ArcRotateCamera;

    // Only react to the primary button (left mouse / single touch contact).
    override buttons = [0];

    /** Screen pixels per radian for desktop shift-drag rotation. */
    angularSensibilityX = 500;
    angularSensibilityY = 500;

    // Horizontal plane at the grabbed point, and the world point under the
    // pointer when the pan gesture started. Both null while not panning.
    private _panPlane: Nullable<Plane> = null;
    private _panAnchor: Nullable<Vector3> = null;

    // Angle (radians) between the two touch points on the previous multi-touch
    // frame, used to derive the twist delta. Null resets the baseline.
    private _previousTwistAngle: Nullable<number> = null;

    // Two-finger arbitration state. `_multiStarted` tracks whether the reference
    // pose below has been captured for the current two-finger gesture; the
    // reference pose is what activation thresholds are measured against.
    private _twoFingerMode: TwoFingerMode = "none";
    private _multiStarted = false;
    private _startPinchDistance = 0;
    private _startAngle = 0;
    private _startMidX = 0;
    private _startMidY = 0;

    override getClassName(): string {
        return "MapCameraPointersInput";
    }

    // -- Single pointer: pan (or shift-rotate on desktop) -------------------

    override onButtonDown(evt: IPointerEvent): void {
        // Any change to the set of pressed pointers invalidates the current
        // pan anchor and two-finger arbitration state; they are re-established
        // on the next move so switching between gestures stays seamless.
        this._resetMultiTouch();
        this._stopPan();

        if (this._isPanGesture(evt)) {
            this._startPan(evt.clientX, evt.clientY);
        }
    }

    override onButtonUp(_evt: IPointerEvent): void {
        this._resetMultiTouch();
        this._stopPan();
    }

    override onTouch(point: Nullable<PointerTouch>, offsetX: number, offsetY: number): void {
        if (!point) {
            // Pointer-lock movement; not used by the map camera.
            return;
        }

        // Shift + mouse drag orbits instead of panning.
        if (point.type !== "touch" && this._shiftKey) {
            this._stopPan();
            this.camera.alpha -= offsetX / this.angularSensibilityX;
            this.camera.beta -= offsetY / this.angularSensibilityY;
            return;
        }

        // Lazily (re-)anchor the pan, e.g. after lifting one finger of a pinch.
        if (!this._panPlane || !this._panAnchor) {
            this._startPan(point.x, point.y);
            return;
        }

        const hit = this._pickPlane(point.x, point.y);
        if (!hit) {
            return;
        }

        // Shift the target so the grabbed world point moves back under the pointer.
        this.camera.target.addInPlace(this._panAnchor.subtract(hit));
    }

    // -- Two pointers: pan, twist, tilt, pinch (arbitrated) -----------------

    override onMultiTouch(
        pointA: Nullable<PointerTouch>,
        pointB: Nullable<PointerTouch>,
        previousPinchSquaredDistance: number,
        pinchSquaredDistance: number,
        previousMultiTouchPanPosition: Nullable<PointerTouch>,
        multiTouchPanPosition: Nullable<PointerTouch>,
    ): void {
        // pinchSquaredDistance === 0 (and the null midpoint) is the base class's
        // gesture-end signal, fired when a finger lifts.
        if (!pointA || !pointB || pinchSquaredDistance === 0 || !multiTouchPanPosition) {
            this._resetMultiTouch();
            return;
        }

        const distance = Math.sqrt(pinchSquaredDistance);
        const angle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
        const midX = multiTouchPanPosition.x;
        const midY = multiTouchPanPosition.y;

        // First frame of the gesture: capture the reference pose, commit to
        // nothing yet.
        if (!this._multiStarted) {
            this._multiStarted = true;
            this._twoFingerMode = "none";
            this._startPinchDistance = distance;
            this._startAngle = angle;
            this._startMidX = midX;
            this._startMidY = midY;
            this._previousTwistAngle = angle;
            return;
        }

        // Wait for one gesture to cross its activation threshold, then lock the
        // interaction into the corresponding mode for the rest of the touch.
        if (this._twoFingerMode === "none") {
            this._twoFingerMode = this._detectMode(distance, angle, midX, midY);
            if (this._twoFingerMode === "none") {
                this._previousTwistAngle = angle;
                return;
            }
        }

        const mode = this._twoFingerMode;

        // Pinch -> zoom. Natural scaling keeps the target framing stable as the
        // fingers move; the camera clamps radius to its configured limits.
        if (this._isAllowed(mode, "zoom") && previousPinchSquaredDistance > 0) {
            const radius = this.camera.radius || 1;
            this.camera.radius =
                (radius * Math.sqrt(previousPinchSquaredDistance)) / Math.sqrt(pinchSquaredDistance);
        }

        // Twist -> rotate (alpha), using the per-frame angle delta.
        if (this._isAllowed(mode, "twist") && this._previousTwistAngle !== null) {
            this.camera.alpha += this._angleDelta(this._previousTwistAngle, angle);
        }

        // Vertical midpoint travel -> tilt (beta); camera clamps to beta limits.
        if (this._isAllowed(mode, "tilt") && previousMultiTouchPanPosition) {
            const offsetY = midY - previousMultiTouchPanPosition.y;
            this.camera.beta -= offsetY / this.angularSensibilityY;
        }

        // Horizontal midpoint travel -> pan along the ground.
        if (this._isAllowed(mode, "pan") && previousMultiTouchPanPosition) {
            this._panByMidpoint(previousMultiTouchPanPosition, multiTouchPanPosition);
        }

        this._previousTwistAngle = angle;
    }

    override onLostFocus(): void {
        this._stopPan();
        this._resetMultiTouch();
    }

    // -- Helpers ------------------------------------------------------------

    private _isPanGesture(evt: IPointerEvent): boolean {
        if (evt.pointerType === "touch") {
            return true;
        }
        // Left mouse button without shift pans; shift is reserved for rotation.
        return evt.button === 0 && !evt.shiftKey;
    }

    private _startPan(clientX: number, clientY: number): void {
        const scene = this.camera.getScene();
        const { x, y } = this._toCanvas(clientX, clientY);

        // Anchor to the surface under the pointer when there is one, otherwise
        // fall back to a plane through the current target.
        const surfaceHit = scene.pick(x, y, undefined, false, this.camera);
        const anchorPoint = surfaceHit?.hit ? surfaceHit.pickedPoint : null;

        this._panPlane = Plane.FromPositionAndNormal(anchorPoint ?? this.camera.target, Vector3.Up());
        this._panAnchor = anchorPoint ?? this._pickPlane(clientX, clientY);
    }

    private _stopPan(): void {
        this._panPlane = null;
        this._panAnchor = null;
    }

    /** Intersect the pointer ray with the active pan plane, in world space. */
    private _pickPlane(clientX: number, clientY: number): Nullable<Vector3> {
        if (!this._panPlane) {
            return null;
        }
        return this._intersectPlane(this._panPlane, clientX, clientY);
    }

    /** Intersect the ray through a screen point with an arbitrary world plane. */
    private _intersectPlane(plane: Plane, clientX: number, clientY: number): Nullable<Vector3> {
        const scene = this.camera.getScene();
        const { x, y } = this._toCanvas(clientX, clientY);
        const ray = scene.createPickingRay(x, y, Matrix.Identity(), this.camera, false);
        const distance = ray.intersectsPlane(plane);
        if (distance === null) {
            return null;
        }

        return ray.origin.add(ray.direction.scale(distance));
    }

    // -- Two-finger arbitration helpers -------------------------------------

    /** Reset arbitration so the next two-finger frame re-captures its baseline. */
    private _resetMultiTouch(): void {
        this._multiStarted = false;
        this._twoFingerMode = "none";
        this._previousTwistAngle = null;
    }

    /**
     * Return the first gesture to cross its activation threshold, measured
     * against the reference pose. When several cross on the same frame the one
     * furthest past its threshold (largest ratio) wins.
     */
    private _detectMode(distance: number, angle: number, midX: number, midY: number): TwoFingerMode {
        const candidates: { mode: TwoFingerMode; ratio: number }[] = [
            { mode: "pan", ratio: Math.abs(midX - this._startMidX) / PAN_ACTIVATE_PX },
            { mode: "tilt", ratio: Math.abs(midY - this._startMidY) / TILT_ACTIVATE_PX },
            { mode: "zoom", ratio: Math.abs(distance - this._startPinchDistance) / PINCH_ACTIVATE_PX },
            { mode: "twist", ratio: Math.abs(this._angleDelta(this._startAngle, angle)) / TWIST_ACTIVATE_RAD },
        ];

        let winner: TwoFingerMode = "none";
        let best = 1; // must reach at least the threshold (ratio >= 1) to activate
        for (const candidate of candidates) {
            if (candidate.ratio >= best) {
                best = candidate.ratio;
                winner = candidate.mode;
            }
        }
        return winner;
    }

    /** Which gestures a locked mode permits, per the arbitration rules. */
    private _isAllowed(mode: TwoFingerMode, gesture: TwoFingerMode): boolean {
        switch (mode) {
            case "pan":
                return true; // everything
            case "twist":
                return gesture !== "tilt";
            case "zoom":
                return gesture === "zoom" || gesture === "pan";
            case "tilt":
                return gesture === "tilt";
            default:
                return false;
        }
    }

    /** Shortest signed angle from `from` to `to`, in (-PI, PI]. */
    private _angleDelta(from: number, to: number): number {
        let delta = to - from;
        if (delta > Math.PI) {
            delta -= 2 * Math.PI;
        } else if (delta < -Math.PI) {
            delta += 2 * Math.PI;
        }
        return delta;
    }

    /**
     * Pan the target freely from the two-finger midpoint travel. Scale-correct
     * via the ground plane through the target, so the grabbed ground point
     * tracks the fingers in both axes. Tilt can never run alongside pan-driven
     * vertical motion (tilt-first locks out every other gesture), so there is
     * no conflict to guard against.
     */
    private _panByMidpoint(previous: PointerTouch, current: PointerTouch): void {
        const plane = Plane.FromPositionAndNormal(this.camera.target, Vector3.Up());
        const hitPrevious = this._intersectPlane(plane, previous.x, previous.y);
        const hitCurrent = this._intersectPlane(plane, current.x, current.y);
        if (!hitPrevious || !hitCurrent) {
            return;
        }

        // Move the target so the grabbed ground point follows the fingers.
        this.camera.target.addInPlace(hitPrevious.subtract(hitCurrent));
    }

    /** Convert page-space pointer coordinates to canvas-local coordinates. */
    private _toCanvas(clientX: number, clientY: number): { x: number; y: number } {
        const element = this.camera.getScene().getEngine().getInputElement() as HTMLElement;
        const rect = element.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }
}

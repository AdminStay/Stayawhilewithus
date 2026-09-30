// The website's typecheck only sees this module's typing for "ws" through
// this reference (ws ships no types; @types/ws isn't installed).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./ws.d.ts" />
import WebSocket from "ws";

/**
 * Cielo thermostat SETPOINT control (2026-09-30) — the only Cielo command
 * StayWhile implements. There is no public Cielo developer API; this is a
 * field-for-field port of the actively maintained bodyscape/cielo_home
 * integration (commit 1b0aaaaa, 2026-07-13) — the same source the existing
 * read path (client.ts) was built from:
 *
 *   - Transport: a WebSocket to wss://wss.smartcielo.com/websocket/ with
 *     `sessionId` + `token` query params (cielohome.py async_connect_wss).
 *     There is no REST command endpoint in that source.
 *   - Frame: `_get_base_msg()` + `_send_msg(action, "temp", value)` +
 *     `_get_action()` (cielohomedevice.py) — one "actionControl" frame.
 *   - Result: the server pushes a "StateUpdate" message for the device's
 *     mac_address carrying `action.temp` (data_receive()).
 *
 * Deliberately NOT implemented (each sends more than one frame or has
 * side effects in the reference): power (power on also sends a mode
 * frame), HVAC mode (turns power on first), fan (also rewrites swing).
 * Only devices that confirm Fahrenheit at BOTH device and appliance level
 * are accepted, so the value is never unit-converted (the reference
 * converts to the appliance unit before sending).
 */

const WSS_URL = "wss://wss.smartcielo.com/websocket/";
const WEB_ORIGIN = "https://home.cielowigle.com";
const WEB_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";
const APPLICATION_VERSION = "1.4.4";

/** Conservative first-version limits (°F), on top of the appliance's own range. */
export const CIELO_SETPOINT_SAFETY = {
  minF: 60,
  maxF: 85,
  /** Largest change allowed in one command, relative to the current target. */
  maxStepF: 5,
} as const;

export const CIELO_ALLOWED_SETPOINT_MODES = ["heat", "cool", "auto"] as const;

export interface CieloSession {
  accessToken: string;
  userId: string;
  sessionId: string;
}

/** What a setpoint command needs from one live `/web/devices` entry. */
export interface CieloControlSnapshot {
  macAddress: string;
  deviceName: string;
  online: boolean;
  deviceIsFahrenheit: boolean;
  applianceIsFahrenheit: boolean;
  /** appliance.temp, e.g. "62:86", or "inc:dec" (no absolute setpoint). */
  applianceTempRange: string | null;
  isMultiModeTempRange: boolean;
  modesTemp: Array<{ mode: string; temp: string }> | null;
  /** appliance.mode — the reference's light rule depends on it. */
  applianceModes: string | null;
  applianceType: string | null;
  applianceId: number | null;
  fwVersion: string | null;
  deviceTypeVersion: string | null;
  connectionSource: number | null;
  myRuleConfiguration: unknown;
  latestAction: {
    power?: string;
    mode?: string;
    fanspeed?: string;
    temp?: string;
    swing?: string;
    turbo?: string;
    light?: string;
    followme?: string;
  };
  currentTemperatureF: number | null;
  targetTemperatureF: number | null;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isOne(value: unknown): boolean {
  return value === 1 || value === "1";
}

/** Parses one raw `/web/devices` entry. Missing fields stay null — never guessed. */
export function parseCieloControlSnapshot(
  raw: Record<string, unknown>,
): CieloControlSnapshot {
  const appliance = (raw.appliance ?? {}) as Record<string, unknown>;
  const latest = (raw.latestAction ?? {}) as Record<string, unknown>;
  const latEnv = (raw.latEnv ?? {}) as Record<string, unknown>;
  const deviceIsFahrenheit = isOne(raw.isFaren);
  const modesTemp = Array.isArray(appliance.modesTemp)
    ? (appliance.modesTemp as Array<Record<string, unknown>>)
        .map((m) => ({ mode: str(m.mode) ?? "", temp: str(m.temp) ?? "" }))
        .filter((m) => m.mode !== "" && m.temp !== "")
    : null;
  const latestAction: CieloControlSnapshot["latestAction"] = {};
  for (const key of [
    "power",
    "mode",
    "fanspeed",
    "temp",
    "swing",
    "turbo",
    "light",
    "followme",
  ] as const) {
    const value = str(latest[key]);
    if (value !== undefined) latestAction[key] = value;
  }
  return {
    macAddress: str(raw.macAddress) ?? "",
    deviceName: str(raw.deviceName) ?? "",
    online: raw.deviceStatus === 1 || String(raw.deviceStatus) === "on",
    deviceIsFahrenheit,
    applianceIsFahrenheit: isOne(appliance.isFaren),
    applianceTempRange: str(appliance.temp) ?? null,
    isMultiModeTempRange: isOne(appliance.isMultiModeTempRange),
    modesTemp,
    applianceModes: str(appliance.mode) ?? null,
    applianceType: str(raw.applianceType) ?? null,
    applianceId: num(raw.applianceId),
    fwVersion: str(raw.fwVersion) ?? null,
    deviceTypeVersion: str(raw.deviceTypeVersion) ?? null,
    connectionSource: num(raw.connectionSource),
    myRuleConfiguration: raw.myRuleConfiguration ?? {},
    latestAction,
    currentTemperatureF: deviceIsFahrenheit ? num(latEnv.temp) : null,
    targetTemperatureF: deviceIsFahrenheit ? num(latest.temp) : null,
  };
}

/** The appliance's own absolute range for the current mode, or null. */
export function cieloSetpointRange(
  snapshot: CieloControlSnapshot,
): { min: number; max: number } | null {
  let range = snapshot.applianceTempRange;
  if (snapshot.isMultiModeTempRange && snapshot.modesTemp) {
    const forMode = snapshot.modesTemp.find(
      (m) => m.mode === snapshot.latestAction.mode,
    );
    if (forMode) range = forMode.temp;
  }
  if (!range || range === "inc:dec") return null;
  const [a, b] = range.split(":");
  const min = num(a);
  const max = num(b);
  if (min === null || max === null || min > max) return null;
  return { min, max };
}

export type CieloSetpointValidation =
  | {
      allowed: true;
      currentTargetF: number;
      bounds: { min: number; max: number };
    }
  | { allowed: false; reason: string };

/** Every rule a setpoint must pass before anything is sent. */
export function validateCieloSetpoint(
  snapshot: CieloControlSnapshot,
  targetF: number,
): CieloSetpointValidation {
  if (!Number.isInteger(targetF)) {
    return {
      allowed: false,
      reason: "The temperature must be a whole number (°F).",
    };
  }
  if (!snapshot.online) {
    return {
      allowed: false,
      reason: "The thermostat is offline in Cielo right now.",
    };
  }
  if (!snapshot.deviceIsFahrenheit || !snapshot.applianceIsFahrenheit) {
    return {
      allowed: false,
      reason:
        "Cielo doesn't confirm Fahrenheit for this unit, so StayWhile won't send a temperature to it.",
    };
  }
  if (snapshot.latestAction.power !== "on") {
    return {
      allowed: false,
      reason:
        "The unit is powered off. StayWhile only changes the setpoint of a unit that is already on.",
    };
  }
  const mode = snapshot.latestAction.mode;
  if (
    !mode ||
    !(CIELO_ALLOWED_SETPOINT_MODES as readonly string[]).includes(mode)
  ) {
    return {
      allowed: false,
      reason: `Setpoint changes are only allowed in heat, cool or auto mode (current mode: ${mode ?? "unknown"}).`,
    };
  }
  const range = cieloSetpointRange(snapshot);
  if (!range) {
    return {
      allowed: false,
      reason:
        "Cielo doesn't report an absolute temperature range for this unit.",
    };
  }
  const current = snapshot.targetTemperatureF;
  if (current === null) {
    return { allowed: false, reason: "The current setpoint isn't known." };
  }
  if (
    snapshot.applianceId === null ||
    !snapshot.applianceType ||
    !snapshot.fwVersion ||
    !snapshot.deviceTypeVersion ||
    snapshot.connectionSource === null ||
    snapshot.latestAction.fanspeed === undefined ||
    snapshot.latestAction.swing === undefined
  ) {
    return {
      allowed: false,
      reason:
        "Cielo didn't return all the device details a command needs; nothing was sent.",
    };
  }
  const bounds = {
    min: Math.max(range.min, CIELO_SETPOINT_SAFETY.minF),
    max: Math.min(range.max, CIELO_SETPOINT_SAFETY.maxF),
  };
  if (targetF < bounds.min || targetF > bounds.max) {
    return {
      allowed: false,
      reason: `Choose a temperature between ${bounds.min}°F and ${bounds.max}°F.`,
    };
  }
  if (targetF === current) {
    return { allowed: false, reason: `The setpoint is already ${current}°F.` };
  }
  if (Math.abs(targetF - current) > CIELO_SETPOINT_SAFETY.maxStepF) {
    return {
      allowed: false,
      reason: `Change the setpoint by at most ${CIELO_SETPOINT_SAFETY.maxStepF}°F at a time (currently ${current}°F).`,
    };
  }
  return { allowed: true, currentTargetF: current, bounds };
}

/**
 * The exact "actionControl" frame the reference sends for a setpoint on a
 * unit that supports absolute temperatures. Call only after
 * validateCieloSetpoint() allowed it.
 */
export function buildCieloSetpointFrame(
  snapshot: CieloControlSnapshot,
  session: Pick<CieloSession, "userId">,
  targetF: number,
  nowSeconds: number,
): Record<string, unknown> {
  const latest = snapshot.latestAction;
  // _get_action()
  const actions: Record<string, unknown> = {
    power: latest.power,
    mode: latest.mode,
    fanspeed: latest.fanspeed,
    temp: latest.temp,
    swing: latest.swing,
    swinginternal: "",
  };
  if (latest.turbo !== undefined) actions.turbo = latest.turbo;
  if (latest.light !== undefined) {
    actions.light = latest.light === "on/off" ? "off" : latest.light;
  } else if (snapshot.applianceModes !== "mode") {
    actions.light = "off";
  }
  if (latest.followme !== undefined) actions.followme = latest.followme;
  // send_temperature(): action["temp"] = str(value)
  actions.temp = String(targetF);

  return {
    // _get_base_msg("actionControl")
    action: "actionControl",
    actionSource: "WEB",
    macAddress: snapshot.macAddress,
    user_id: session.userId,
    fw_version: snapshot.fwVersion,
    deviceTypeVersion: snapshot.deviceTypeVersion,
    mid: "WEB",
    connection_source: snapshot.connectionSource,
    application_version: APPLICATION_VERSION,
    ts: nowSeconds,
    // _send_msg()
    fwVersion: snapshot.fwVersion,
    applianceType: snapshot.applianceType,
    applianceId: snapshot.applianceId,
    myRuleConfiguration: snapshot.myRuleConfiguration,
    preset: 0,
    actions,
    oldPower: latest.power,
    actionType: "temp",
    actionValue: targetF,
  };
}

export type CieloSendState = "not_sent" | "sent" | "uncertain";

export interface CieloFrameOutcome {
  /**
   * not_sent: the connection never opened — nothing reached Cielo.
   * sent: the frame was written to an open socket.
   * uncertain: the socket failed while/after writing.
   */
  sendState: CieloSendState;
  /** A StateUpdate for this device reported the requested setpoint. */
  confirmedByStateUpdate: boolean;
  /** Any StateUpdate for this device arrived (even with another value). */
  stateUpdateSeen: boolean;
  /** Setpoint reported by the last StateUpdate for this device, if any. */
  reportedTargetF: number | null;
  error?: string;
}

/** Minimal socket surface, so tests can inject a fake. */
export interface CieloSocketLike {
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "close", listener: (code: number) => void): unknown;
  send(data: string, cb?: (err?: Error) => void): void;
  close(): void;
}

export type CieloSocketFactory = (
  url: string,
  options: {
    headers: Record<string, string>;
    origin: string;
    handshakeTimeout: number;
  },
) => CieloSocketLike;

const defaultSocketFactory: CieloSocketFactory = (url, options) =>
  new WebSocket(url, { ...options, perMessageDeflate: true });

/**
 * Opens one WebSocket, sends exactly one frame, waits (up to timeoutMs)
 * for this device's StateUpdate showing the requested setpoint, then
 * closes. Never retries and never sends a second frame.
 */
export function sendCieloFrameAndAwaitState(args: {
  session: Pick<CieloSession, "accessToken" | "sessionId">;
  frame: Record<string, unknown>;
  macAddress: string;
  targetF: number;
  timeoutMs: number;
  createSocket?: CieloSocketFactory;
}): Promise<CieloFrameOutcome> {
  const createSocket = args.createSocket ?? defaultSocketFactory;
  const url = `${WSS_URL}?sessionId=${encodeURIComponent(args.session.sessionId)}&token=${encodeURIComponent(args.session.accessToken)}`;

  return new Promise<CieloFrameOutcome>((resolve) => {
    const outcome: CieloFrameOutcome = {
      sendState: "not_sent",
      confirmedByStateUpdate: false,
      stateUpdateSeen: false,
      reportedTargetF: null,
    };
    let settled = false;
    let socket: CieloSocketLike | null = null;

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && !outcome.error) outcome.error = error;
      try {
        socket?.close();
      } catch {
        // closing is best effort
      }
      resolve(outcome);
    };

    const timer = setTimeout(() => finish(), args.timeoutMs);

    try {
      socket = createSocket(url, {
        headers: {
          Host: "wss.smartcielo.com",
          "Cache-control": "no-cache",
          Pragma: "no-cache",
          "User-agent": WEB_USER_AGENT,
        },
        origin: WEB_ORIGIN,
        handshakeTimeout: Math.min(args.timeoutMs, 10_000),
      });
    } catch (err) {
      finish(
        err instanceof Error
          ? err.message
          : "Could not open the Cielo connection.",
      );
      return;
    }

    socket.on("open", () => {
      try {
        socket!.send(JSON.stringify(args.frame), (err?: Error) => {
          if (err) {
            outcome.sendState = "uncertain";
            finish(err.message);
          }
        });
        outcome.sendState = "sent";
      } catch (err) {
        outcome.sendState = "uncertain";
        finish(err instanceof Error ? err.message : "Sending failed.");
      }
    });

    socket.on("message", (data: unknown) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (
        parsed.message_type !== "StateUpdate" ||
        String(parsed.mac_address ?? "") !== args.macAddress
      ) {
        return;
      }
      outcome.stateUpdateSeen = true;
      const action = (parsed.action ?? {}) as Record<string, unknown>;
      outcome.reportedTargetF = num(action.temp);
      if (outcome.reportedTargetF === args.targetF) {
        outcome.confirmedByStateUpdate = true;
        finish();
      }
    });

    socket.on("error", (err: Error) => {
      if (outcome.sendState === "sent") outcome.sendState = "uncertain";
      finish(err.message);
    });

    socket.on("close", () => {
      finish();
    });
  });
}

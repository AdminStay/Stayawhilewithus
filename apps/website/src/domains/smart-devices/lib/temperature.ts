/**
 * Nest's SDM API is Celsius-only (both telemetry and commands); StayWhile's
 * dashboard displays Fahrenheit throughout (US-based properties — see
 * ThermostatsList/toSmartDeviceMetadata). These are the only two places
 * that conversion should ever happen — every other layer stays in
 * whichever unit it already owns (SmartDevice.metadata: Fahrenheit for
 * display; ProviderDevice.rawMetadata/SDM commands: Celsius, unconverted).
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export function formatUsdcAmount(value: number): string {
    const rounded = Number(value.toFixed(6));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
}

import type { HermesResponse, PriceUpdate, PythPriceData } from "../types.ts";

export function parsePriceUpdate(data: HermesResponse): PriceUpdateResult {
    if (!data.parsed || data.parsed.length === 0) {
        return { ok: false, message: "No price data returned from Hermes" };
    }

    if (!data.binary?.data || data.binary.data.length === 0) {
        return { ok: false, message: "No VAA binary data returned from Hermes" };
    }

    const priceData: PythPriceData = data.parsed[0];
    const vaa: string = data.binary.data[0];

    return { ok: true, value: { priceData, vaa } };
}

export type PriceUpdateResult =
  | { ok: true; value: PriceUpdate }
  | { ok: false; message: string };

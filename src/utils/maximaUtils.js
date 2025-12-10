// src/utils/maximaUtils.js
import { MDS } from "@minima-global/mds";

/**
 * Envia un missatge via Maxima
 */
export async function sendMessageToMaxima(toAddress, text) {
  if (!MDS) throw new Error("MDS no inicialitzat");

  try {
    const res = await MDS.cmd.maxima({
      params: {
        action: "send",
        to: toAddress,
        message: text,
      },
    });
    return res.response;
  } catch (err) {
    console.error("Error enviant missatge via Maxima:", err);
    throw err;
  }
}

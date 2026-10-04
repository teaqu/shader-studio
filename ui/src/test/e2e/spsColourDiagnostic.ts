import { addEmulationPreventionBytes, parseAvcSps } from "../../../../node_modules/mediabunny/dist/modules/src/codec-data.js";

type ColourField = "primaries" | "transfer";

/** Change one existing SPS colour field, preserving all sample bytes and MP4 box sizes. */
export async function patchMp4SpsColourDiagnostic(blob: Blob, field: ColourField, value: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const findAvcc = (start: number, end: number): [number, number] | undefined => {
    for (let offset = start; offset + 8 <= end;) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > end) {
        throw new Error("Diagnostic MP4 box length is invalid");
      }
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      const payload = offset + 8;
      if (type === "avcC") {
        return [payload, offset + size];
      }
      const skip = type === "stsd" ? 8 : type === "avc1" || type === "avc3" ? 78 : 0;
      if (["moov", "trak", "mdia", "minf", "stbl", "stsd", "avc1", "avc3"].includes(type)) {
        const result = findAvcc(payload + skip, offset + size);
        if (result) {
          return result;
        }
      }
      offset += size;
    }
  };
  const avcc = findAvcc(0, bytes.length);
  if (!avcc) {
    throw new Error("Diagnostic MP4 has no AVC configuration");
  }
  let offset = avcc[0] + 6;
  for (let index = 0; index < (bytes[avcc[0] + 5] & 31); index++) {
    const length = view.getUint16(offset);
    const nal = bytes.slice(offset + 2, offset + 2 + length);
    const info = parseAvcSps(nal);
    if (!info) {
      throw new Error("Diagnostic SPS could not be parsed");
    }
    const rbsp = info.emulationUnpreventedBytes.slice();
    let position = info.vuiParametersFlagBitOffset;
    const read = (count: number) => {
      let value = 0;
      for (let bit = 0; bit < count; bit++, position++) {
        value = value * 2 + ((rbsp[position >> 3] >> (7 - (position & 7))) & 1);
      }
      return value;
    };
    if (!read(1)) {
      throw new Error("Diagnostic SPS has no VUI");
    }
    if (read(1) && read(8) === 255) {
      read(32);
    }
    if (read(1)) {
      read(1);
    }
    if (!read(1)) {
      throw new Error("Diagnostic SPS has no video signal type");
    }
    read(4);
    if (!read(1)) {
      throw new Error("Diagnostic SPS has no colour description");
    }
    const colourOffset = position + (field === "transfer" ? 8 : 0);
    for (let bit = 0; bit < 8; bit++) {
      const target = colourOffset + bit;
      const mask = 1 << (7 - (target & 7));
      rbsp[target >> 3] = (rbsp[target >> 3] & ~mask) | (((value >> (7 - bit)) & 1) ? mask : 0);
    }
    const patched = addEmulationPreventionBytes(rbsp);
    const result = parseAvcSps(patched);
    if (!result || patched.length !== length) {
      throw new Error("Diagnostic SPS length changed");
    }
    if (result.matrixCoefficients !== info.matrixCoefficients || result.fullRangeFlag !== info.fullRangeFlag ||
        (field === "primaries" ? result.transferCharacteristics !== info.transferCharacteristics : result.colourPrimaries !== info.colourPrimaries)) {
      throw new Error("Diagnostic changed another colour field");
    }
    console.log("SPS colour field diagnostics", JSON.stringify({ field,
      before: { primaries: info.colourPrimaries, transfer: info.transferCharacteristics, matrix: info.matrixCoefficients, fullRange: info.fullRangeFlag },
      after: { primaries: result.colourPrimaries, transfer: result.transferCharacteristics, matrix: result.matrixCoefficients, fullRange: result.fullRangeFlag },
      changedNalBytes: Array.from(nal, (byte, index) => byte === patched[index] ? -1 : index).filter(index => index >= 0),
    }));
    bytes.set(patched, offset + 2);
    offset += length + 2;
  }
  return new Blob([bytes], { type: blob.type });
}

// src/utils/fileUtils.ts

export async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Failed to read file"));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function validateFile(file: File): { valid: boolean; message?: string } {
  if (file.size !== 1024) {
    return { valid: false, message: "File must be exactly 1024 bytes" };
  }

  if (!file.type.includes("text")) {
    return { valid: false, message: "File must be a text file" };
  }

  return { valid: true };
}

export function downloadUint8Array(
  data: Uint8Array,
  filename: string = "received_file.txt",
): void {
  // ✅ Materialize into a safe BlobPart
  const blob = new Blob([new Uint8Array(data)], { type: "text/plain" });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function generateRandomFileId(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

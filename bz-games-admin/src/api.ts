export class ApiError extends Error {
  constructor(
    public readonly status: number,
    code: string,
  ) {
    super(code);
  }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options?.body && !isFormData
        ? { "content-type": "application/json" }
        : {}),
      ...options?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error || `http_${response.status}`,
    );
  }
  return body as T;
}

export function upload<T>(
  url: string,
  form: FormData,
  onProgress: (percent: number) => void,
  method = "POST",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
      }
    };
    request.onerror = () => reject(new ApiError(0, "network_error"));
    request.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(request.responseText || "{}");
      } catch {
        body = {};
      }
      if (request.status < 200 || request.status >= 300) {
        reject(
          new ApiError(
            request.status,
            typeof body.error === "string"
              ? body.error
              : `http_${request.status}`,
          ),
        );
        return;
      }
      resolve(body as T);
    };
    request.send(form);
  });
}

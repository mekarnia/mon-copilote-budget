export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/**
 * Lit une réponse envoyée par morceaux (Server-Sent Events).
 * Sans cela, une réponse de coach de plusieurs secondes n'apparaît qu'à la fin :
 * le même temps d'attente, mais devant un écran vide.
 */
export async function lireFlux(
  url: string,
  body: unknown,
  sur: { [event: string]: (donnee: unknown) => void },
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, message);
  }
  const lecteur = res.body.getReader();
  const decodeur = new TextDecoder();
  let reste = "";
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    reste += decodeur.decode(value, { stream: true });
    // Un événement se termine par une ligne vide ; le morceau final peut être
    // incomplet et attend le paquet suivant.
    const blocs = reste.split("\n\n");
    reste = blocs.pop() ?? "";
    for (const bloc of blocs) {
      let event = "message";
      let data = "";
      for (const ligne of bloc.split("\n")) {
        if (ligne.startsWith("event:")) event = ligne.slice(6).trim();
        else if (ligne.startsWith("data:")) data += ligne.slice(5).trim();
      }
      if (!data || !sur[event]) continue;
      try {
        sur[event](JSON.parse(data));
      } catch {
        /* morceau illisible : on continue plutôt que d'interrompre la réponse */
      }
    }
  }
}

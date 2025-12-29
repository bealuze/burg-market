function normalizeBaseUrl(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "";
	return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function normalizeToken(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const lowered = trimmed.toLowerCase();
	if (lowered === "null" || lowered === "undefined") return null;
	return trimmed;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!BASE_URL) {
	throw new Error("VITE_API_BASE_URL is not defined");
}
const TOKEN_KEY = "token";

function safeStorageGet(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeStorageSet(key, value) {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

function safeStorageRemove(key) {
	try {
		localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

export function getToken() {
	return normalizeToken(safeStorageGet(TOKEN_KEY));
}

export function setToken(token) {
	const normalized = normalizeToken(token);
	if (!normalized) {
		safeStorageRemove(TOKEN_KEY);
		return;
	}
	safeStorageSet(TOKEN_KEY, normalized);
}

export function clearToken() {
	safeStorageRemove(TOKEN_KEY);
}

async function request(path, { method = "GET", body, token } = {}) {
	if (!BASE_URL) {
		throw new Error(
			"API base URL is not configured. Set VITE_API_BASE_URL (e.g. https://api.burg-market.com)."
		);
	}
	const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
	const headers = isFormData ? {} : { "Content-Type": "application/json" };
	const normalizedToken = normalizeToken(token);
	if (normalizedToken) headers.Authorization = `Bearer ${normalizedToken}`;
	const url = `${BASE_URL}${path}`;

	let res;
	try {
		res = await fetch(url, {
			method,
			headers,
			credentials: "include",
			body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
		});
	} catch (err) {
		const detail = err && typeof err.message === "string" ? err.message : String(err);
		const lower = String(detail || "").toLowerCase();
		const looksLikeCors =
			lower.includes("failed to fetch") ||
			lower.includes("load failed") ||
			lower.includes("networkerror") ||
			lower.includes("cors");
		const hint = looksLikeCors
			? " This usually means the API request was blocked (CORS), the API is unreachable, or the browser blocked the request in private/mobile mode. Check that VITE_API_BASE_URL is correct and that the API allows your site origin."
			: "";
		const e = new Error(`Network error (${method} ${url}): ${detail}.${hint}`);
		e.isNetworkError = true;
		throw e;
	}

	const contentType = res.headers.get("content-type") || "";
	const isJson = contentType.includes("application/json");
	const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

	if (!res.ok) {
		const bodyText =
			(data && typeof data === "object" && !Array.isArray(data) ? JSON.stringify(data) : null) ||
			(typeof data === "string" ? data : null);
		const baseMessage = (data && data.error) || (typeof data === "string" ? data : null) || "Request failed.";
		const preview = bodyText ? bodyText.slice(0, 400) : "";
		const err = new Error(`HTTP ${res.status}: ${baseMessage}${preview && preview !== baseMessage ? ` — ${preview}` : ""}`);
		err.status = res.status;
		err.data = data;
		throw err;
	}

	return data;
}

export function apiGetListings() {
	return request("/api/listings");
}

export function apiGetMyListings(token) {
	return request("/api/mylistings", { token });
}

export function apiCreateListing(token, { title, description, price, imageUrl, contactMethod, contactValue }) {
	const form = new FormData();
	form.append("title", title);
	form.append("description", description);
	form.append("price", String(price));
	if (contactMethod) form.append("contactMethod", contactMethod);
	if (contactValue) form.append("contactValue", contactValue);
	if (imageUrl instanceof File) {
		form.append("image", imageUrl);
	} else {
		// legacy call sites may still pass imageUrl string
		throw new Error("Image is required.");
	}

	return request("/api/listings", { method: "POST", token, body: form });
}

export function apiDeleteListing(token, id) {
	return request(`/api/listings/${id}`, { method: "DELETE", token });
}

export function apiMarkListingSold(token, id) {
	return request(`/api/listings/${id}/sold`, { method: "PATCH", token });
}

export function apiGetListingContact(token, id) {
	return request(`/api/listings/${id}/contact`, { token });
}

export function apiRegister({ email, password }) {
	return request("/api/auth/register", { method: "POST", body: { email, password } });
}

export function apiVerify({ email, code }) {
	return request("/api/auth/verify", { method: "POST", body: { email, code } });
}

export function apiLogin({ email, password }) {
	return request("/api/auth/login", { method: "POST", body: { email, password } });
}

export function apiForgotPassword({ email }) {
	return request("/api/auth/forgot", { method: "POST", body: { email } });
}

export function apiResetPassword({ email, code, newPassword }) {
	return request("/api/auth/reset", { method: "POST", body: { email, code, newPassword } });
}

export function apiLogout() {
	return request("/api/auth/logout", { method: "POST" });
}

function normalizeBaseUrl(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "";
	return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

const BASE_URL =
	normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL) ||
	"http://localhost:3000";
const TOKEN_KEY = "token";

export function getToken() {
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
	localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body, token } = {}) {
	const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
	const headers = isFormData ? {} : { "Content-Type": "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(`${BASE_URL}${path}`, {
		method,
		headers,
		credentials: "include",
		body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
	});

	const contentType = res.headers.get("content-type") || "";
	const isJson = contentType.includes("application/json");
	const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

	if (!res.ok) {
		const message = (data && data.error) || (typeof data === "string" ? data : null) || "Request failed.";
		const err = new Error(message);
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

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const r2 = require("../utils/r2");

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

function absoluteUrl(req, maybePath) {
	if (!maybePath || typeof maybePath !== "string") return null;
	const value = maybePath.trim();
	if (!value) return null;
	if (/^https?:\/\//i.test(value)) return value;
	if (value.startsWith("/")) return `${req.protocol}://${req.get("host")}${value}`;
	return `${req.protocol}://${req.get("host")}/${value}`;
}

function normalizeStatus(value) {
	const v = typeof value === "string" ? value.trim().toLowerCase() : "";
	return v === "sold" ? "sold" : "active";
}

function fileKeyFromPublicUrl(imageUrl) {
	if (!imageUrl || typeof imageUrl !== "string") return null;
	const base = process.env.R2_PUBLIC_BASE;
	if (!base || typeof base !== "string") return null;
	const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
	if (!imageUrl.startsWith(`${normalizedBase}/`)) return null;
	return imageUrl.slice(normalizedBase.length + 1);
}

function deleteListingAndImageById(listingId, cb) {
	db.get(`SELECT image_url FROM listings WHERE id = ?`, [listingId], (err, row) => {
		if (err) return cb(err);
		const imageUrl = row?.image_url;
		const fileKey = fileKeyFromPublicUrl(imageUrl);

		const deleteDbRow = () => {
			db.run(`DELETE FROM listings WHERE id = ?`, [listingId], (err2) => {
				if (err2) return cb(err2);
				return cb(null);
			});
		};

		if (!fileKey) return deleteDbRow();
		r2
			.send(
				new DeleteObjectCommand({
					Bucket: process.env.R2_BUCKET,
					Key: fileKey,
				})
			)
			.then(() => deleteDbRow())
			.catch(() => deleteDbRow());
	});
}

function requireVerifiedUser(req, res, next) {
	db.get(`SELECT is_verified FROM users WHERE id = ?`, [req.userId], (err, row) => {
		if (err) return res.status(500).json({ error: "Database error." });
		if (!row) return res.status(401).json({ error: "User not found." });
		if (row.is_verified !== 1) return res.status(403).json({ error: "Email not verified." });
		return next();
	});
}

// PUBLIC
// GET /api/listings - Return all listings (no contact info)
router.get("/listings", (req, res) => {
	db.all(
		`SELECT id,
			title,
			description,
			price,
			image_url as imageUrl,
			COALESCE(status, 'active') as status,
			sold_at as soldAt,
			user_id as userId,
			created_at as createdAt
		FROM listings
		ORDER BY datetime(created_at) DESC`,
		[],
		(err, rows) => {
			if (err) return res.status(500).json({ error: "Database error." });
			const mapped = (rows || []).map((r) => ({
				...r,
				imageUrl: absoluteUrl(req, r.imageUrl),
				status: normalizeStatus(r.status),
			}));
			return res.json(mapped);
		}
	);
});

// PROTECTED
// POST /api/listings - Create a listing (verified users only)
router.post("/listings", authMiddleware, requireVerifiedUser, upload.single("image"), (req, res) => {
	const { title, description, price, contactMethod, contactValue } = req.body || {};

	if (!title || typeof title !== "string") {
		return res.status(400).json({ error: "Title is required." });
	}
	if (description !== undefined && description !== null && typeof description !== "string") {
		return res.status(400).json({ error: "Invalid description." });
	}
	if (typeof description === "string" && description.length > 100) {
		return res.status(400).json({ error: "Description must be 100 characters or less." });
	}
	const priceRaw = typeof price === "string" ? price.trim() : price;
	if (priceRaw === undefined || priceRaw === null || priceRaw === "" || Number.isNaN(Number(priceRaw))) {
		return res.status(400).json({ error: "Price is required." });
	}
	if (!req.file) {
		return res.status(400).json({ error: "Image is required." });
	}
	if (typeof req.file.mimetype !== "string" || !req.file.mimetype.startsWith("image/")) {
		return res.status(400).json({ error: "Only image uploads are allowed." });
	}

	const normalizedMethod = typeof contactMethod === "string" ? contactMethod.trim().toLowerCase() : "email";
	const allowedMethods = new Set(["email", "phone", "instagram"]);
	if (!allowedMethods.has(normalizedMethod)) {
		return res.status(400).json({ error: "Invalid contact method." });
	}

	const normalizedTitle = title.trim();
	const normalizedDescription = typeof description === "string" ? description.trim() : "";
	const normalizedPrice = Number(price);
	const normalizedContactValue = typeof contactValue === "string" ? contactValue.trim() : "";
	const fileKey = `listings/${crypto.randomUUID()}-${req.file.originalname}`;

	const uploadToR2 = async () => {
		await r2.send(
			new PutObjectCommand({
				Bucket: process.env.R2_BUCKET,
				Key: fileKey,
				Body: req.file.buffer,
				ContentType: req.file.mimetype,
			})
		);
		return `${process.env.R2_PUBLIC_BASE}/${fileKey}`;
	};

	if (!normalizedTitle) return res.status(400).json({ error: "Title is required." });
	if (normalizedPrice < 0) return res.status(400).json({ error: "Price must be non-negative." });
	if (normalizedMethod !== "email" && !normalizedContactValue) {
		return res.status(400).json({ error: "Contact value is required." });
	}
	if (normalizedMethod === "phone") {
		const ok = /^\d+$/.test(normalizedContactValue);
		if (!ok) return res.status(400).json({ error: "Phone must contain digits only." });
	}

	function computeContactDisplay(method, value) {
		if (method === "email") return value;
		if (method === "phone") return value;
		if (method === "instagram") {
			if (!value) return "";
			return value.startsWith("@") ? value : `@${value}`;
		}
		return value;
	}

	if (normalizedMethod === "email") {
		// Email contact defaults to user's school email.
		db.get(`SELECT email FROM users WHERE id = ?`, [req.userId], (err, row) => {
			if (err) return res.status(500).json({ error: "Database error." });
			if (!row) return res.status(401).json({ error: "User not found." });

			(async () => {
				try {
					const imageUrl = await uploadToR2();
					const finalContactValue = String(row.email || "");
					const finalContactDisplay = computeContactDisplay("email", finalContactValue);
					db.run(
						`INSERT INTO listings (title, description, price, contact, user_id, image_url, contact_method, contact_value, status)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							normalizedTitle,
							normalizedDescription,
							normalizedPrice,
							finalContactDisplay,
							req.userId,
							imageUrl,
							"email",
							finalContactValue,
							"active",
						],
						function (err2) {
							if (err2) return res.status(500).json({ error: "Database error." });
							return res.status(201).json({ message: "Listing created.", id: this.lastID });
						}
					);
				} catch (e) {
					return res.status(500).json({ error: "Image upload failed." });
				}
			})();
		});
		return;
	}

	(async () => {
		try {
			const imageUrl = await uploadToR2();
			const finalContactDisplay = computeContactDisplay(normalizedMethod, normalizedContactValue);
			db.run(
				`INSERT INTO listings (title, description, price, contact, user_id, image_url, contact_method, contact_value, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					normalizedTitle,
					normalizedDescription,
					normalizedPrice,
					finalContactDisplay,
					req.userId,
					imageUrl,
					normalizedMethod,
					normalizedContactValue,
					"active",
				],
				function (err) {
					if (err) return res.status(500).json({ error: "Database error." });
					return res.status(201).json({ message: "Listing created.", id: this.lastID });
				}
			);
		} catch (e) {
			return res.status(500).json({ error: "Image upload failed." });
		}
	})();
});

// GET /api/mylistings - Return listings created by logged-in user (verified users only)
router.get("/mylistings", authMiddleware, requireVerifiedUser, (req, res) => {
	db.all(
		`SELECT id,
			title,
			description,
			price,
			image_url as imageUrl,
			COALESCE(status, 'active') as status,
			sold_at as soldAt,
			contact_method as contactMethod,
			contact_value as contactValue,
			contact,
			user_id as userId,
			created_at as createdAt
		FROM listings
		WHERE user_id = ?
		ORDER BY datetime(created_at) DESC`,
		[req.userId],
		(err, rows) => {
			if (err) return res.status(500).json({ error: "Database error." });
			const mapped = (rows || []).map((r) => ({
				...r,
				imageUrl: absoluteUrl(req, r.imageUrl),
				status: normalizeStatus(r.status),
			}));
			return res.json(mapped);
		}
	);
});

// GET /api/listings/:id/contact - Return only contact field (verified users only)
router.get("/listings/:id/contact", authMiddleware, requireVerifiedUser, (req, res) => {
	const listingId = Number(req.params.id);
	if (!Number.isInteger(listingId)) return res.status(400).json({ error: "Invalid listing id." });

	function computeContactDisplay(method, value, legacyContact) {
		if (legacyContact && typeof legacyContact === "string" && legacyContact.trim()) return legacyContact;
		if (method === "email") return value || "";
		if (method === "phone") return value || "";
		if (method === "instagram") {
			if (!value) return "";
			return value.startsWith("@") ? value : `@${value}`;
		}
		return value || "";
	}

	db.get(
		`SELECT COALESCE(status, 'active') as status, contact_method, contact_value, contact FROM listings WHERE id = ?`,
		[listingId],
		(err, row) => {
		if (err) return res.status(500).json({ error: "Database error." });
		if (!row) return res.status(404).json({ error: "Listing not found." });
		const status = normalizeStatus(row.status);
		if (status === "sold") return res.status(403).json({ error: "Listing is sold." });
		const method = typeof row.contact_method === "string" ? row.contact_method : null;
		const value = typeof row.contact_value === "string" ? row.contact_value : null;
		return res.json({
			contact: computeContactDisplay(method, value, row.contact),
			contactMethod: method,
			contactValue: value,
		});
		}
	);
});

// PATCH /api/listings/:id/sold - Only owner can mark sold
router.patch("/listings/:id/sold", authMiddleware, (req, res) => {
	const listingId = Number(req.params.id);
	if (!Number.isInteger(listingId)) return res.status(400).json({ error: "Invalid listing id." });

	db.get(`SELECT id, user_id FROM listings WHERE id = ?`, [listingId], (err, row) => {
		if (err) return res.status(500).json({ error: "Database error." });
		if (!row) return res.status(404).json({ error: "Listing not found." });
		if (row.user_id !== req.userId) return res.status(403).json({ error: "Forbidden." });

		db.run(
			`UPDATE listings SET status = 'sold', sold_at = CURRENT_TIMESTAMP WHERE id = ?`,
			[listingId],
			(err2) => {
				if (err2) return res.status(500).json({ error: "Database error." });
				return res.json({ message: "Marked as sold." });
			}
		);
	});
});

// DELETE /api/listings/:id - Only owner can delete
router.delete("/listings/:id", authMiddleware, (req, res) => {
	const listingId = Number(req.params.id);
	if (!Number.isInteger(listingId)) return res.status(400).json({ error: "Invalid listing id." });

	db.get(`SELECT id, user_id FROM listings WHERE id = ?`, [listingId], (err, row) => {
		if (err) return res.status(500).json({ error: "Database error." });
		if (!row) return res.status(404).json({ error: "Listing not found." });
		if (row.user_id !== req.userId) return res.status(403).json({ error: "Forbidden." });

		deleteListingAndImageById(listingId, (err2) => {
			if (err2) return res.status(500).json({ error: "Database error." });
			return res.json({ message: "Listing deleted." });
		});
	});
});

module.exports = router;

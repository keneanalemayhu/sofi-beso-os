// // src/controllers/payment.controller.ts

// import { Request, Response } from "express";
// import { pool } from "../db";
// import type { Server as IOServer } from "socket.io";

// const ALLOWED_METHODS = ["cash", "transfer", "telebirr", "cbe", "other"] as const;

// function getIO(req: Request): IOServer | undefined {
//   return req.app.locals.io as IOServer | undefined;
// }

// export async function recordPayment(req: Request, res: Response) {
//   const { order_id, method, amount } = req.body as {
//     order_id: string;
//     method: string;
//     amount: number;
//   };

//   if (!order_id || !ALLOWED_METHODS.includes(method as any)) {
//     return res.status(400).json({ error: "Invalid payment data" });
//   }

//   const paidAmount = Number(amount);
//   if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
//     return res.status(400).json({ error: "Invalid amount" });
//   }

//   try {
//     const orderRes = await pool.query(
//       `SELECT total_amount FROM orders WHERE id = $1`,
//       [order_id]
//     );

//     if (!orderRes.rows.length) {
//       return res.status(404).json({ error: "Order not found" });
//     }

//     const totalAmount = Number(orderRes.rows[0].total_amount);
//     if (paidAmount < totalAmount) {
//       return res.status(400).json({ error: "Insufficient payment amount" });
//     }

//     await pool.query(
//       `INSERT INTO payments (order_id, method, amount)
//        VALUES ($1, $2, $3)`,
//       [order_id, method, paidAmount]
//     );

//     await pool.query(
//       `UPDATE orders
//        SET status = 'completed', completed_at = NOW()
//        WHERE id = $1`,
//       [order_id]
//     );

//     getIO(req)?.emit("payment_update", { orderId: order_id });
//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Payment failed" });
//   }
// }
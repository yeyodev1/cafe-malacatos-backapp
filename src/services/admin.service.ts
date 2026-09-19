import { Order } from "../models/order.model";
import { User } from "../models/user.model";

const PAGE_SIZE = 20;
// Ecuador continental es UTC-5 todo el año (sin horario de verano). Vercel
// corre en UTC: sin este ajuste "hoy" cambiaría a las 7 de la noche.
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Inicio del día y del mes calendario en hora de Ecuador, como instantes UTC. */
function ecuadorBoundaries(now = new Date()) {
  const local = new Date(now.getTime() - ECUADOR_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    startOfDay: new Date(Date.UTC(year, month, local.getUTCDate()) + ECUADOR_OFFSET_MS),
    startOfMonth: new Date(Date.UTC(year, month, 1) + ECUADOR_OFFSET_MS),
  };
}

export async function getStats() {
  const { startOfDay, startOfMonth } = ecuadorBoundaries();

  const [ordersToday, pendingVerification, toShip, revenue] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: startOfDay } }),
    Order.countDocuments({ status: "awaiting_verification" }),
    Order.countDocuments({ status: "paid" }),
    Order.aggregate([
      {
        $match: {
          status: { $in: ["paid", "shipped", "delivered"] },
          paidAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$totalCents" } } },
    ]),
  ]);

  return {
    ordersToday,
    pendingVerification,
    toShip,
    revenueMonthCents: revenue[0]?.total ?? 0,
  };
}

export async function listCustomers(query: { page?: unknown }) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const filter = { accountType: "customer" };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    User.countDocuments(filter),
  ]);

  const counts: { _id: unknown; count: number }[] = await Order.aggregate([
    { $match: { user: { $in: users.map((user: any) => user._id) } } },
    { $group: { _id: "$user", count: { $sum: 1 } } },
  ]);
  const countByUser = new Map(counts.map((row) => [String(row._id), row.count]));

  const items = users.map((user: any) => ({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    ordersCount: countByUser.get(user._id.toString()) ?? 0,
  }));

  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

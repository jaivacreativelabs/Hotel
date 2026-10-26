import { model, Schema, type InferSchemaType } from 'mongoose';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '@rb/shared';

/** Money a branch spent. Deleting only marks it DELETED so the audit trail stays complete. */
const expenseSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    /** YYYY-MM-DD in APP_TIMEZONE – the day the money was spent */
    date: { type: String, required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 1 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    note: { type: String, default: '', maxlength: 200 },
    status: { type: String, enum: ['ACTIVE', 'DELETED'], default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    editedAt: { type: Date, default: null },
    editedByName: { type: String, default: '' },
  },
  { timestamps: true },
);

expenseSchema.index({ branchId: 1, status: 1, date: -1 });
expenseSchema.index({ status: 1, date: -1 });

export type Expense = InferSchemaType<typeof expenseSchema>;
export const ExpenseModel = model('Expense', expenseSchema);

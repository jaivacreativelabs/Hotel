import { model, Schema, type ClientSession } from 'mongoose';

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const CounterModel = model('Counter', counterSchema);

/** Atomically increments and returns the next sequence value for `key`. */
export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  ).lean();
  return doc!.seq;
}

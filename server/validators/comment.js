// @ts-check

import { createInsertSchema } from "drizzle-zod";
import { comments } from "../../db/schema/index.js";
import { formatZodErrors } from "./errors.js";

// Схема комментария выводится из таблицы, как и схема статьи: обязательность
// полей не дублируется руками. article_id подставляет роут, поэтому валидации
// здесь только поля формы.
const commentSchema = createInsertSchema(comments, {
  author: (schema) => schema.min(1),
  content: (schema) => schema.min(1),
}).pick({ author: true, content: true });

export const validateComment = (data) => {
  const result = commentSchema.safeParse(data ?? {});

  return result.success
    ? { data: result.data, errors: null }
    : { data: null, errors: formatZodErrors(result.error) };
};

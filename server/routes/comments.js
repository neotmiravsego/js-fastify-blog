// @ts-check

import { asc, eq } from "drizzle-orm";
import i18next from "i18next";
import { articles, comments } from "../../db/schema/index.js";
import { validateComment } from "../validators/comment.js";

// Комментарии всегда выводятся под статьёй в одном и том же порядке: старые
// сверху. id на втором месте делает порядок детерминированным, когда несколько
// строк получили одинаковое время.
export const findComments = async (app, articleId) =>
  app.db
    .select()
    .from(comments)
    .where(eq(comments.articleId, articleId))
    .orderBy(asc(comments.createdAt), asc(comments.id));

export default (app) => {
  app.post("/articles/:id/comments", { name: "createComment" }, async (req, reply) => {
    const articleId = Number(req.params.id);
    const [article] = await app.db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    // Без статьи комментарий не имеет смысла: не даём создать сироту даже при
    // обходе формы прямым запросом.
    if (!article) {
      return reply.callNotFound();
    }

    const { data, errors } = validateComment(req.body?.data);

    if (errors) {
      req.flash("error", i18next.t("views.comment.create.error"));
      reply.code(422);
      reply.render("articles/show", {
        article,
        comments: await findComments(app, article.id),
        comment: req.body?.data ?? {},
        errors,
      });
      return reply;
    }

    await app.db.insert(comments).values({ ...data, articleId: article.id });
    req.flash("info", i18next.t("views.comment.create.success"));
    reply.redirect(app.reverse("article", { id: article.id }));
    return reply;
  });
};

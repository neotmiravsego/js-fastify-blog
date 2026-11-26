// @ts-check

import { and, asc, eq } from "drizzle-orm";
import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { articles, comments } from "../db/schema/index.js";
import init from "../server/plugin.js";

// TODO: сейчас каждый тест оставляет после себя артефакты в БД
// попытатся использовать транзакции или перед каждым тестом очищать БД

describe("requests", () => {
  let app;

  // Sequelize отдавал модель с findOne/findByPk. У drizzle это запросы, поэтому
  // два маленьких хелпера вместо повторения select().from().where() в каждом
  // тесте. `?? null` сохраняет прежнее поведение: не найдено это null, а не
  // undefined, и проверки toBeNull() остаются осмысленными.
  const findArticle = async ({ title, content }) => {
    const [article] = await app.db
      .select()
      .from(articles)
      .where(and(eq(articles.title, title), eq(articles.content, content)))
      .limit(1);

    return article ?? null;
  };

  const findArticleById = async (id) => {
    const [article] = await app.db.select().from(articles).where(eq(articles.id, id)).limit(1);

    return article ?? null;
  };

  const findComments = async (articleId) =>
    app.db
      .select()
      .from(comments)
      .where(eq(comments.articleId, articleId))
      .orderBy(asc(comments.createdAt), asc(comments.id));

  const createArticle = async (title) => {
    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: { title, content: `${title} content` } },
    });

    return findArticle({ title, content: `${title} content` });
  };

  beforeAll(async () => {
    app = fastify({
      exposeHeadRoutes: false,
      logger: { target: "pino-pretty" },
    });
    await init(app);
  });

  test("GET 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: app.reverse("root"),
    });
    expect(res.statusCode).toBe(200);
  });

  test("GET 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/wrong-path",
    });
    expect(res.statusCode).toBe(404);
  });

  test("show articles - GET /articles", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/articles",
    });

    expect(response.statusCode).toBe(200);
  });

  test("new article - GET /articles/new", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/articles/new",
    });

    expect(response.statusCode).toBe(200);
  });

  test("create article - POST /articles", async () => {
    const newArticleData = {
      title: "Article 1",
      content: "Article 1 content",
    };

    const response = await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    expect(response.statusCode).toBe(302);

    const article = await findArticle(newArticleData);
    expect(article).not.toBeNull();
  });

  test("edit article - GET /articles/:id", async () => {
    const newArticleData = {
      title: "Article 2",
      content: "Article 2 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "GET",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(200);
  });

  test("update article - PATCH /articles/:id", async () => {
    const newArticleData = {
      title: "Article 3",
      content: "Article 3 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const updatedArticleData = {
      title: "Article updated",
      content: "Article updated content",
    };

    const response2 = await app.inject({
      method: "PATCH",
      url: `/articles/${newArticle.id}`,
      payload: {
        data: updatedArticleData,
      },
    });

    expect(response2.statusCode).toBe(302);

    const updatedArticle = await findArticle(updatedArticleData);
    expect(updatedArticle).not.toBeNull();
    const article = await findArticle(newArticleData);
    expect(article).toBeNull();
  });

  // Формы отправляют PATCH и DELETE как POST со скрытым полем `_method`,
  // потому что HTML умеет только GET и POST. Прямые PATCH и DELETE проверяются
  // выше, здесь проверяется именно подмена.
  test("update article - POST with _method=patch", async () => {
    const articleData = {
      title: "Article via _method",
      content: "Article via _method content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });

    const article = await findArticle(articleData);

    const updatedData = {
      title: "Article via _method updated",
      content: "Article via _method updated content",
    };

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}`,
      payload: { _method: "patch", data: updatedData },
    });

    expect(response.statusCode).toBe(302);
    expect(await findArticle(updatedData)).not.toBeNull();
  });

  test("delete article - POST with _method=delete", async () => {
    const articleData = {
      title: "Article to delete via _method",
      content: "Article to delete via _method content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });

    const article = await findArticle(articleData);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}`,
      payload: { _method: "delete" },
    });

    expect(response.statusCode).toBe(302);
    expect(await findArticleById(article.id)).toBeNull();
  });

  // POST-маршрута на этом адресе нет: там объявлены PATCH и DELETE, а POST
  // доходит до них только через `_method`. Без него отвечает «не найдено», а не
  // «метод не разрешён»: раньше 405 отдавал разбор `_method`, написанный руками
  // в роутере, теперь его делает @hexlet/fastify-method-override.
  test("POST without _method is not found", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/articles/1",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  test("delete article - DELETE /articles/:id", async () => {
    const newArticleData = {
      title: "Article 4",
      content: "Article 4 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "DELETE",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(302);

    const updatedArticle = await findArticle(newArticleData);
    expect(updatedArticle).toBeNull();
  });

  test("show article - GET /articles/:id", async () => {
    const newArticleData = {
      title: "Article 5",
      content: "Article 5 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "GET",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(200);
  });

  test("create comment - POST /articles/:id/comments", async () => {
    const article = await createArticle("Article with comments");

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: {
          author: "Unique Comment Author",
          content: "First comment content",
        },
      },
    });

    expect(response.statusCode).toBe(302);

    const [comment] = await findComments(article.id);
    expect(comment).toBeDefined();
    expect(comment.author).toBe("Unique Comment Author");
    expect(comment.content).toBe("First comment content");
    // Имя сохраняется в БД, но не выводится на странице статьи.
    expect(response.body).not.toContain("Unique Comment Author");
  });

  test("create comment with invalid data - 422", async () => {
    const article = await createArticle("Article with invalid comment");

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: { author: "Reader To Keep", content: "" },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(await findComments(article.id)).toHaveLength(0);
    expect(response.body).toContain("Reader To Keep");
  });

  test("show comments - GET /articles/:id", async () => {
    const article = await createArticle("Article with comment list");

    for (const content of ["Alpha comment", "Beta comment"]) {
      const response = await app.inject({
        method: "POST",
        url: `/articles/${article.id}/comments`,
        payload: { data: { author: `Author ${content}`, content } },
      });

      expect(response.statusCode).toBe(302);
    }

    const stored = await findComments(article.id);
    expect(stored.map((comment) => comment.content)).toEqual(["Alpha comment", "Beta comment"]);

    const response = await app.inject({
      method: "GET",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Alpha comment");
    expect(response.body).toContain("Beta comment");
    expect(response.body.indexOf("Alpha comment")).toBeLessThan(
      response.body.indexOf("Beta comment"),
    );
    expect(response.body).not.toContain("Author Alpha comment");
    expect(response.body).not.toContain("Author Beta comment");
  });

  test("create comment for missing article - 404", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/articles/999999/comments",
      payload: { data: { author: "Reader", content: "Orphan comment" } },
    });

    expect(response.statusCode).toBe(404);
    expect(await app.db.select().from(comments).where(eq(comments.articleId, 999999))).toHaveLength(
      0,
    );
  });

  test("delete article removes its comments", async () => {
    const article = await createArticle("Article to delete with comment");

    await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: { data: { author: "Reader", content: "Comment to delete" } },
    });

    expect(await findComments(article.id)).toHaveLength(1);

    const response = await app.inject({
      method: "DELETE",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(302);
    expect(await findComments(article.id)).toHaveLength(0);
  });

  afterAll(async () => {
    await app.close();
  });
});

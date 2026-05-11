const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseFeedPostsStorage = require("../storages/CourseFeedPostsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseFeedPostsService");

const MESSAGE_MAX_LEN = 1000;

function sanitizeMessage(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, MESSAGE_MAX_LEN);
}

function buildCourseUrl(course) {
  return course?.slug ? `/cursos/${course.slug}` : null;
}

function buildFeedTitle(course) {
  return `Curso: ${course.title}`.slice(0, 200);
}

function buildFeedDescription(course, message) {
  const parts = [];
  if (message) parts.push(message);
  if (course.short_description) parts.push(course.short_description);
  if (!parts.length && course.description) {
    parts.push(String(course.description).slice(0, 500));
  }
  return parts.join("\n\n") || null;
}

function shape(row, course) {
  if (!row) {
    return {
      course_id: course.id,
      portfolio_item_id: null,
      message: null,
      status: "missing",
      is_active: false,
      published_at: null,
      project_url: buildCourseUrl(course),
      likes_count: 0,
      shares_count: 0,
      impressions_count: 0,
    };
  }
  return {
    id: row.id,
    course_id: row.course_id,
    portfolio_item_id: row.portfolio_item_id,
    message: row.message || null,
    title: row.title,
    description: row.description,
    project_url: row.project_url,
    status: row.status,
    is_active: !!row.is_active,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    likes_count: row.likes_count ?? 0,
    shares_count: row.shares_count ?? 0,
    impressions_count: row.impressions_count ?? 0,
  };
}

async function loadOwnedCourse(conn, user, courseId) {
  if (!user?.id_user) return { error: "Não autenticado" };
  if (!courseId) return { error: "ID inválido" };

  const course = await CoursesStorage.getById(conn, courseId);
  if (!course) return { error: "Curso não encontrado" };
  if (course.owner_user_id !== user.id_user) {
    return { error: "Sem permissão para acessar este curso" };
  }
  return { course };
}

class CourseFeedPostsService {
  static async get(user, courseId) {
    return runWithLogs(
      log,
      "get",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        const loaded = await loadOwnedCourse(pool, user, courseId);
        if (loaded.error) return loaded;

        const publication = await CourseFeedPostsStorage.getByCourseId(
          pool,
          courseId,
        );
        return {
          course: loaded.course,
          feed_post: shape(publication, loaded.course),
        };
      },
    );
  }

  static async publish(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "publish",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const loaded = await loadOwnedCourse(client, user, courseId);
          if (loaded.error) {
            await client.query("ROLLBACK");
            return loaded;
          }
          const course = loaded.course;

          if (course.status !== "published") {
            await client.query("ROLLBACK");
            return { error: "Publique o curso antes de divulgar no feed" };
          }
          if (!course.profile_id) {
            await client.query("ROLLBACK");
            return { error: "Vincule um perfil ao curso antes de divulgar no feed" };
          }
          if (!course.slug) {
            await client.query("ROLLBACK");
            return { error: "Slug do curso inválido" };
          }

          const message = sanitizeMessage(body.message);
          const existing = await CourseFeedPostsStorage.getByCourseId(
            client,
            courseId,
          );

          const portfolioItem = existing?.portfolio_item_id
            ? await CourseFeedPostsStorage.updatePortfolioItem(
                client,
                existing.portfolio_item_id,
                {
                  profileId: course.profile_id,
                  title: buildFeedTitle(course),
                  description: buildFeedDescription(course, message),
                  projectUrl: buildCourseUrl(course),
                  updatedBy: user.id_user,
                  publish: true,
                },
              )
            : await CourseFeedPostsStorage.createPortfolioItem(client, {
                profileId: course.profile_id,
                title: buildFeedTitle(course),
                description: buildFeedDescription(course, message),
                projectUrl: buildCourseUrl(course),
                createdBy: user.id_user,
              });

          await CourseFeedPostsStorage.syncCoverMedia(client, {
            portfolioItemId: portfolioItem.id_portfolio_item,
            coverUrl: course.cover_url || null,
            createdBy: user.id_user,
          });

          await CourseFeedPostsStorage.upsertPublication(client, {
            courseId,
            portfolioItemId: portfolioItem.id_portfolio_item,
            message,
          });

          await CoursesStorage.updateById(client, courseId, {
            feed_post_id: portfolioItem.id_portfolio_item,
          });
          const updatedCourse = await CoursesStorage.getById(client, courseId);
          const publication = await CourseFeedPostsStorage.getByCourseId(
            client,
            courseId,
          );

          await client.query("COMMIT");
          return {
            course: updatedCourse,
            feed_post: shape(publication, updatedCourse),
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }

  static async remove(user, courseId) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const loaded = await loadOwnedCourse(client, user, courseId);
          if (loaded.error) {
            await client.query("ROLLBACK");
            return loaded;
          }

          const publication = await CourseFeedPostsStorage.getByCourseId(
            client,
            courseId,
          );
          if (publication?.portfolio_item_id) {
            await CourseFeedPostsStorage.archivePortfolioItem(
              client,
              publication.portfolio_item_id,
              user.id_user,
            );
          }

          await CoursesStorage.updateById(client, courseId, {
            feed_post_id: null,
          });
          const updatedCourse = await CoursesStorage.getById(client, courseId);
          const nextPublication = await CourseFeedPostsStorage.getByCourseId(
            client,
            courseId,
          );

          await client.query("COMMIT");
          return {
            course: updatedCourse,
            feed_post: shape(nextPublication, updatedCourse),
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseFeedPostsService;

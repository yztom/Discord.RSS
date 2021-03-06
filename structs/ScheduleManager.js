const config = require('../config.js')
const FeedSchedule = require('./FeedSchedule.js')
const debugFeeds = require('../util/debugFeeds.js').list
const ArticleMessageQueue = require('./ArticleMessageQueue.js')
const storage = require('../util/storage.js')
const log = require('../util/logger.js')

class ScheduleManager {
  constructor (bot, customSchedules, feedData) { // Third parameter is only used when config.database.uri is a databaseless folder path
    this.bot = bot
    this.articleMessageQueue = new ArticleMessageQueue()
    this.scheduleList = []
    storage.scheduleManager = this
    // Set up the default schedule
    this.scheduleList.push(new FeedSchedule(this.bot, { name: 'default', refreshTimeMinutes: config.feeds.refreshTimeMinutes }, feedData, this))
    // Set up custom schedules
    if (customSchedules) for (var i = 0; i < customSchedules.length; ++i) this.scheduleList.push(new FeedSchedule(this.bot, customSchedules[i], null, this))
    for (const schedule of this.scheduleList) {
      schedule.on('article', this._queueArticle.bind(this))
      schedule.on('finish', this._finishSchedule.bind(this))
    }
  }

  async _queueArticle (article) {
    if (debugFeeds.includes(article._delivery.rssName)) log.debug.info(`${article._delivery.rssName} ScheduleManager queueing article ${article.link} to send`)
    try {
      await this.articleMessageQueue.send(article)
    } catch (err) {
      if (config.log.linkErrs === true) {
        const channel = this.bot.channels.get(article._delivery.channelId)
        log.general.warning(`Failed to send article ${article.link}`, channel.guild, channel, err)
        if (err.code === 50035) channel.send(`Failed to send formatted article for article <${article.link}> due to misformation.\`\`\`${err.message}\`\`\``).catch(err => log.general.warning(`Unable to send failed-to-send message for article`, err))
      }
    }
  }

  _finishSchedule () {
    this.articleMessageQueue.sendDelayed()
  }

  addSchedule (schedule) {
    if (!schedule) throw new TypeError('schedule is not defined for addSchedule')
    if (!schedule.refreshTimeMinutes || (!schedule.keywords && !schedule.rssNames)) throw new TypeError('refreshTimeMinutes, keywords or rssNames is missing in schedule to addSchedule')
    const feedSchedule = new FeedSchedule(this.bot, schedule, null, this)
    this.scheduleList.push(feedSchedule)
    feedSchedule.on('article', this._queueArticle.bind(this))
    feedSchedule.on('finish', this._finishSchedule.bind(this))
    if (this.bot.shard && this.bot.shard.count > 0) process.send({ _drss: true, type: 'addCustomSchedule', schedule: schedule })
  }

  run (refreshTime) { // Run schedules with respect to their refresh times
    for (var feedSchedule of this.scheduleList) {
      if (feedSchedule.refreshTime === refreshTime) {
        return feedSchedule.run().catch(err => log.cycle.error(`${this.bot.shard && this.bot.shard.count > 0 ? `SH ${this.bot.shard.id} ` : ''}Schedule ${this.name} failed to run cycle`, err))
      }
    }
    // If there is no schedule with that refresh time
    if (this.bot.shard && this.bot.shard.count > 0) process.send({ _drss: true, type: 'scheduleComplete', refreshTime: refreshTime })
  }

  stopSchedules () {
    this.scheduleList.forEach(schedule => schedule.stop())
    this.scheduleList.length = 0
  }

  getSchedule (name) {
    for (const schedule of this.scheduleList) {
      if (schedule.name === name) return schedule
    }
    return null
  }

  assignSchedules () {
    const promises = []
    for (const schedule of this.scheduleList) promises.push(schedule.run())
    return Promise.all(promises)
  }

  cyclesInProgress (name) {
    for (var feedSchedule of this.scheduleList.length) {
      if (name && feedSchedule.name === name && feedSchedule.inProgress) return true
      else if (feedSchedule.inProgress) return true
    }
    return false
  }
}

module.exports = ScheduleManager

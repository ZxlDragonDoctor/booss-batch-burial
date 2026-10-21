// All schedule dates use Beijing time, regardless of the computer's timezone.
const Daily = {
  dayKey(now = Date.now()) {
    return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  },
  dueAt(time, now = Date.now()) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间必须为 HH:mm');
    return Date.parse(`${this.dayKey(now)}T${time}:00+08:00`);
  },
  nextRun(time, now = Date.now()) {
    const due = this.dueAt(time, now);
    return due > now ? due : due + 86400000;
  },
  shouldRun(config, state, now = Date.now()) {
    return config.scheduleEnabled === true && !state.isRunning && !state.pausedOnCaptcha &&
      state.lastScheduledDate !== this.dayKey(now) && now >= this.dueAt(config.scheduleTime, now);
  }
};

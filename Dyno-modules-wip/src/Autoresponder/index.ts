import { Module } from '@dyno.gg/dyno-core';
import * as eris from '@dyno.gg/eris';
import * as each from 'async-each';
import * as dyno from 'Dyno';
import emojis from './emojis';

/**
 * Autoresponder Module
 * @class Autoresponder
 * @extends Module
 */
export default class Autoresponder extends Module {
	public module     : string  = 'Autoresponder';
	public description: string  = 'Automatically respond to text triggers.';
	public list       : boolean = true;
	public enabled    : boolean = true;
	public hasPartial : boolean = true;

	get settings() {
		return {
			commands: { type: Array, default: [] },
		};
	}

	public start() {
		this._cooldowns = new Map();
		this.schedule('*/1 * * * *', this.clearCooldowns.bind(this));

		this._emojis = Object.values(emojis).reduce((a: any[], arr: any[]) => a.concat(arr), []);
	}

	/**
	 * Message create event handler
	 */
	public messageCreate({ message, guildConfig }: any) {
		if (!message.member ||
			message.author.bot ||
			!message.channel.guild ||
			!guildConfig.autoresponder ||
			!guildConfig.autoresponder.commands) { return; }

		if (!this.isEnabled(message.channel.guild, this.module, guildConfig)) { return; }

		const commands = guildConfig.autoresponder.commands;
		const content  = message.content.toLowerCase();

		const result = commands.filter((c: any) => c).find((c: any) => {
			let text;

			if (c.wildcard) {
				text = `.*${this.utils.regEscape(c.command).replace(/\\?{\\?\*\\?}/g, '.*')}.*`;
			} else {
				text = `^${this.utils.regEscape(c.command).replace(/\\?{\\?\*\\?}/g, '.*')}$`;
			}

			return content.match(new RegExp(text, 'i'));
		});

		if (!content.length || !result) { return; }

		const cooldown = this._cooldowns.get(message.author.id);
		if (cooldown && (Date.now() - cooldown) < 2000) { return; }

		this._cooldowns.set(message.author.id, Date.now());

		if (result.ignoredChannels && result.ignoredChannels.length) {
			if (result.ignoredChannels.find((c: any) => c.id === message.channel.id)) {
					return null;
				}
		}

		if (result.allowedChannels && result.allowedChannels.length) {
			if (!result.allowedChannels.find((c: any) => c.id === message.channel.id)) {
					return null;
				}
		}

		if (result.type === 'reaction') {
			if (!this.config.isPremium) { return; }
			const reactions = result.reactions.map((r: any) => r.native ? this.resolveNative(r) : `${r.name}:${r._id}`);
			for (const r of reactions) {
				this.client.addMessageReaction(message.channel.id, message.id, r)
					.then(() => this.statsd.increment('autoresponder.reactions.success', 1))
					.catch(() => this.statsd.increment('autoresponder.reactions.error'));
			}

			return;
		}

		const data = { guild: message.channel.guild, channel: message.channel, user: message.member };
		const response = this.utils.replacer(result.response, data);

		this.sendMessage(message.channel, response)
			.then(() => this.statsd.increment('autoresponder.messages.success', 1))
			.catch(() => this.statsd.increment('autoresponder.messages.error', 1));
	}

	private resolveNative(emoji: any) {
		const resolvedEmoji = this._emojis.find((e: any) => e.names.includes(emoji.id));
		// const result = this.toUTF16(emoji.codePointAt(0));
		return resolvedEmoji.surrogates;
	}

	private toUTF16(codePoint: number) {
		const TEN_BITS = parseInt('1111111111', 2);
		function u(codeUnit: number) {
			return `\\u${codeUnit.toString(16).toUpperCase()}`;
		}

		if (codePoint <= 0xFFFF) {
			return u(codePoint);
		}
		// tslint:disable-next-line:no-parameter-reassignment
		codePoint -= 0x10000;

		// Shift right to get to most significant 10 bits
		// tslint:disable-next-line:binary-expression-operand-order
		const leadSurrogate = 0xD800 + (codePoint >> 10);

		// Mask to get least significant 10 bits
		// tslint:disable-next-line:binary-expression-operand-order
		const tailSurrogate = 0xDC00 + (codePoint & TEN_BITS);

		return u(leadSurrogate) + u(tailSurrogate);
	}

	private clearCooldowns() {
		each([...this._cooldowns.keys()], (id: string) => {
			const time = this._cooldowns.get(id);
			if ((Date.now() - time) < 2000) { return; }
			this._cooldowns.delete(id);
		});
	}
}

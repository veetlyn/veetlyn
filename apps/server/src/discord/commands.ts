// The registry of the platform's global Discord commands (contract §4.3). `pnpm -F server discord:register`
// bulk-puts this list at PUT /applications/{application.id}/commands, so removed commands disappear.
export type DiscordCommandOption = {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  min_length?: number;
  max_length?: number;
  options?: DiscordCommandOption[];
};

export type DiscordCommand = {
  name: string;
  description: string;
  // 1 = CHAT_INPUT, the only kind the platform ships.
  type: 1;
  options?: DiscordCommandOption[];
};

export function discordCommands(platformName: string): readonly DiscordCommand[] {
  return [
    {
      name: "platform",
      type: 1,
      description: `Manage your ${platformName} services team`,
      options: [
        {
          name: "link",
          type: 1,
          description: "Link this server to your services team",
          options: [
            {
              name: "code",
              type: 3,
              description: "The link code from your team admin",
              required: true,
              max_length: 12,
            },
          ],
        },
      ],
    },
    {
      name: "payouts",
      type: 1,
      description: "PayPal payouts for freelancers",
      options: [
        {
          name: "setup",
          type: 1,
          description: "Set up your PayPal payout destination",
        },
      ],
    },
  ];
}

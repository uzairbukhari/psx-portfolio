'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function UserAvatar({
  name,
  email,
  picture,
  large = false,
}: {
  name: string | null;
  email: string;
  picture: string | null;
  large?: boolean;
}) {
  return (
    <Avatar className={large ? 'user-avatar user-avatar-lg' : 'user-avatar'}>
      {picture && (
        <AvatarImage
          src={picture}
          alt={name ?? email}
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="user-avatar-fallback">
        {(name || email).charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

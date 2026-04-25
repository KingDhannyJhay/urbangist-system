'use client';

import Image          from 'next/image';
import Link           from 'next/link';
import { useState }   from 'react';
import type { Track } from '@/types';
import { formatCount, formatDuration, cn } from '@/lib/utils';
import { Play, Pause, Heart, Share2, Zap } from 'lucide-react';

interface Props {
  track:     Track;
  rank?:     number;
  variant?:  'grid' | 'list';
  isPlaying?: boolean;
  isLiked?:  boolean;
  onPlay?:   (track: Track) => void;
  onLike?:   (id: string)   => void;
  onShare?:  (track: Track) => void;
}

export default function TrackCard({
  track, rank, variant = 'grid',
  isPlaying, isLiked, onPlay, onLike, onShare,
}: Props) {
  const isBoosted = track.boost_multiplier > 1;

  if (variant === 'list') {
    return (
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 border-b border-[#2A2A2A]/60',
        'hover:bg-[#161616] transition-colors group',
      )}>
        {rank && (
          <span className="w-6 text-xs text-[#525252] text-center flex-shrink-0 font-mono">{rank}</span>
        )}

        {/* Cover + play button */}
        <button onClick={() => onPlay?.(track)}
          className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 group/btn">
          <Image src={track.cover_url ?? '/placeholder-cover.jpg'} alt={track.title}
            fill sizes="40px" className="object-cover" />
          <div className={cn(
            'absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity',
            isPlaying ? 'opacity-100' : 'opacity-0 group-hover/btn:opacity-100',
          )}>
            {isPlaying
              ? <div className="flex gap-0.5 items-end h-4">{[0,1,2,3].map(i=><div key={i} className="eq-bar w-0.5" style={{animationDelay:`${i*.1}s`}}/>)}</div>
              : <Play size={14} className="text-white fill-white" />}
          </div>
        </button>

        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <Link href={`/track/${track.slug}`}
            className="text-sm font-semibold text-[#F8F8F8] hover:text-green-500 truncate block transition-colors">
            {track.title}
          </Link>
          <Link href={`/artist/${track.artist.slug}`}
            className="text-xs text-[#525252] hover:text-[#A3A3A3] truncate block transition-colors">
            {track.artist.display_name}
          </Link>
        </div>

        {/* Genre badge */}
        <span className="hidden sm:block text-xs text-[#525252] bg-[#1C1C1C] px-2 py-0.5 rounded-full flex-shrink-0">
          {track.genre}
        </span>

        {/* Stats */}
        <span className="hidden md:block text-xs text-[#525252] w-14 text-right flex-shrink-0">
          {formatCount(track.play_count)}
        </span>

        {isBoosted && (
          <span className="hidden lg:flex badge-boost text-[10px] gap-1 flex-shrink-0">
            <Zap size={9} /> {track.boost_multiplier}×
          </span>
        )}

        {/* Duration */}
        <span className="text-xs text-[#525252] w-10 text-right flex-shrink-0">
          {formatDuration(track.duration_sec)}
        </span>

        {/* Actions */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onLike?.(track.id)}
            className={cn('p-1.5 rounded-lg transition-colors', isLiked ? 'text-red-500' : 'text-[#525252] hover:text-red-400')}>
            <Heart size={13} className={isLiked ? 'fill-current' : ''} />
          </button>
          <button onClick={() => onShare?.(track)}
            className="p-1.5 rounded-lg text-[#525252] hover:text-green-500 transition-colors">
            <Share2 size={13} />
          </button>
        </div>
      </div>
    );
  }

  // Grid variant
  return (
    <div className="group relative">
      {isBoosted && (
        <span className="absolute -top-1.5 -right-1.5 z-10 badge-boost text-[10px] gap-0.5">
          <Zap size={9} />
        </span>
      )}

      {/* Cover */}
      <button onClick={() => onPlay?.(track)}
        className="relative aspect-square w-full rounded-xl overflow-hidden block mb-3">
        <Image src={track.cover_url ?? '/placeholder-cover.jpg'} alt={track.title}
          fill sizes="(max-width:640px)50vw,(max-width:1024px)33vw,200px"
          className="object-cover group-hover:scale-105 transition-transform duration-500" />

        {/* Overlay */}
        <div className={cn(
          'absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent',
          'flex flex-col justify-between p-2.5 transition-opacity duration-200',
          isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}>
          <div className="flex justify-end gap-1">
            <button onClick={e => { e.stopPropagation(); onLike?.(track.id); }}
              className={cn('p-1.5 rounded-full bg-black/50 transition-colors', isLiked ? 'text-red-500' : 'text-white/80 hover:text-red-400')}>
              <Heart size={12} className={isLiked ? 'fill-current' : ''} />
            </button>
            <button onClick={e => { e.stopPropagation(); onShare?.(track); }}
              className="p-1.5 rounded-full bg-black/50 text-white/80 hover:text-green-400 transition-colors">
              <Share2 size={12} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center transition-all',
              'bg-green-500 text-[#0B0B0B] shadow-lg shadow-green-500/40',
            )}>
              {isPlaying
                ? <div className="flex gap-0.5 items-end h-3.5">{[0,1,2,3].map(i=><div key={i} className="eq-bar w-0.5" style={{animationDelay:`${i*.1}s`,height:'4px'}}/>)}</div>
                : <Play size={14} className="fill-current ml-0.5" />}
            </div>
            <span className="text-[10px] text-white/70">{formatDuration(track.duration_sec)}</span>
          </div>
        </div>

        {rank && (
          <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-[10px] font-bold text-white">
            {rank}
          </div>
        )}
      </button>

      {/* Info */}
      <div className="px-0.5">
        <Link href={`/track/${track.slug}`}
          className="text-sm font-semibold text-[#F8F8F8] hover:text-green-500 truncate block transition-colors leading-snug">
          {track.title}
        </Link>
        <Link href={`/artist/${track.artist.slug}`}
          className="text-xs text-[#525252] hover:text-[#A3A3A3] truncate block transition-colors mt-0.5">
          {track.artist.display_name}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-[#525252]">{formatCount(track.play_count)} plays</span>
          <span className="text-[10px] text-[#3A3A3A]">·</span>
          <span className="text-[10px] text-[#525252]">{track.genre}</span>
        </div>
      </div>
    </div>
  );
}

import { Directive, effect, ElementRef, inject, input } from '@angular/core';

/** Asigna un MediaStream a un <video> (srcObject no se puede enlazar con un atributo normal). */
@Directive({ selector: 'video[appSrcObject]' })
export class SrcObjectDirective {
  readonly appSrcObject = input<MediaStream | null>(null);
  private readonly el = inject<ElementRef<HTMLVideoElement>>(ElementRef);

  constructor() {
    effect(() => {
      const video = this.el.nativeElement;
      const stream = this.appSrcObject();
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        if (stream) void video.play().catch(() => undefined);
      }
    });
  }
}

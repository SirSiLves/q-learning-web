import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MazeRoutingModule } from './maze-routing.module';
import { MazeComponent } from './maze.component';
import { RippleModule } from 'primeng/ripple';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';


@NgModule({
  declarations: [
    MazeComponent
  ],
    imports: [
        CommonModule,
        MazeRoutingModule,
        RippleModule,
        ButtonModule,
        FormsModule,
        InputNumberModule,
        SelectButtonModule
    ]
})
export class MazeModule { }

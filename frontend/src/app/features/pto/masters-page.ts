import { Component } from '@angular/core';
import { PageHeader } from '../../ui/page-header';
import { MasterCard } from './master-card';

@Component({
  selector: 'app-masters-page',
  imports: [MasterCard, PageHeader],
  templateUrl: './masters-page.html',
})
export class MastersPage {}

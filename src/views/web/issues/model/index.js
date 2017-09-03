import { observable, computed } from 'mobx'
import { find } from 'lodash'
import { bridgedFunction, addGlobalErrorHandler, exposeFunction, markBridgeAsInitialized } from '../../../bridge/client'
import { analytics, truncateWithEllipsis } from '../../util'
import { FiltersMapper, IssuesMapper, ProfileMapper } from './mapper'

const _loadFilters = bridgedFunction('loadFilters', FiltersMapper)
const _loadIssuesForFilter = bridgedFunction('loadIssuesForFilter', IssuesMapper)
const _getSuggestedPreselectedIssueKey = bridgedFunction('getSuggestedPreselectedIssueKey')
const _loadProfile = bridgedFunction('loadProfile', ProfileMapper)
const _viewSettings = bridgedFunction('viewSettings')
const _reauthorize = bridgedFunction('reauthorize')
const _feedback = bridgedFunction('feedback')
const _onIssueSelected = bridgedFunction('onIssueSelected')
const _onIssueDeselected = bridgedFunction('onIssueDeselected')
const _openFaqPage = bridgedFunction('openFaqPage')
const _areLayersSelected = bridgedFunction('areLayersSelected')

const maxErrorMessageLength = 55

export default class ViewModel {
  @observable filters = {
    list: [],
    selected: null,
    loading: false
  }
  @observable issues = {
    list: [],
    selected: null,
    loading: false
  }
  @observable profile = null
  @observable error = null
  @observable retry = null
  @observable reauthorize = null
  @observable hasSelection = false

  constructor () {
    this.initializeExposedFunctions()
    this.checkIfHasSelection()
    this.loadFilters()
    this.loadProfile()
    this.registerGlobalErrorHandler()
  }

  initializeExposedFunctions () {
    exposeFunction('exportSelectionToSelectedIssue', (issueKey, files) => {
      const issue = find(this.issues.list, issue => {
        return issue.key === issueKey
      })
      issue && issue.uploadExportedSelection(files)
    })
    exposeFunction('setHasSelection', hasSelection => {
      this.hasSelection = hasSelection
    })
    markBridgeAsInitialized()
  }

  async checkIfHasSelection () {
    this.hasSelection = await _areLayersSelected()
  }

  async loadFilters () {
    this.filters.loading = true
    const filters = await _loadFilters()
    this.filters.list.replace(filters)
    if (!this.filters.selected && filters.length) {
      this.selectFilter(filters[0].key)
    }
    this.filters.loading = false
  }

  selectFilter (filterKey) {
    if (this.filters.selected) {
      analytics('viewIssueListFilterChangeTo' + filterKey, { previous: this.filters.selected })
    } else {
      analytics('viewIssueListDefaultFilter' + filterKey)
    }
    this.filters.selected = find(
      this.filters.list,
      filter => filter.key === filterKey
    )
    this.loadIssues()
  }

  async viewSettings () {
    _viewSettings()
  }

  async loadIssues () {
    if (this.filters.selected) {
      this.issues.loading = true
      this.issues.list.clear()
      const selectedKey = this.filters.selected.key
      const issues = await _loadIssuesForFilter(selectedKey)
      if (this.filters.selected.key === selectedKey) {
        this.issues.list.replace(issues)
        await this.setSuggestedIssueIfPresent()
        this.issues.loading = false
      }
    }
  }

  async setSuggestedIssueIfPresent () {
    const suggestedIssueKey = await _getSuggestedPreselectedIssueKey()
    if (suggestedIssueKey) {
      const suggestedIssue = find(
        this.issues.list,
        issue => issue.key === suggestedIssueKey
      )
      if (suggestedIssue) {
        this.selectIssue(suggestedIssue)
      }
    }
  }

  selectIssue (issue) {
    this.issues.selected = issue
    issue.onSelected()
    _onIssueSelected(issue.key)
  }

  deselectIssue () {
    const prevKey = this.issues.selected.key
    this.issues.selected = null
    _onIssueDeselected(prevKey)
    analytics('backToViewIssueList')
  }

  async loadProfile () {
    this.profile = await _loadProfile()
    analytics('viewIssueProfileLoaded')
  }

  @computed get truncatedErrorMessage () {
    return truncateWithEllipsis(this.errorMessage, maxErrorMessageLength)
  }

  @computed get errorMessage () {
    return this.error && (this.error.message || this.error.name)
  }

  async moreInfo () {
    if (this.error && this.error.faqTopic) {
      _openFaqPage(this.error.faqTopic)
    }
  }

  @computed get settings () {
    return [{
      id: 'switch-site',
      label: 'Switch JIRA Cloud site',
      onClick: () => { _reauthorize() }
    }, {
      id: 'feedback',
      label: 'Feedback',
      onClick: () => { _feedback() }
    }]
  }

  registerGlobalErrorHandler () {
    addGlobalErrorHandler((error, retry) => {
      this.error = error
      if (error.name === 'AuthorizationError') {
        this.reauthorize = () => {
          _reauthorize()
        }
      } else {
        this.retry = () => {
          this.error = this.retry = null
          retry()
        }
      }
      // indicate that this error handler will facilitate retries
      return true
    })
  }
}
